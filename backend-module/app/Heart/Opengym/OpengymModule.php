<?php

declare(strict_types=1);

namespace App\Heart\Opengym;

use App\Chat\BrainException;
use App\Core\AuthMiddleware;
use App\Core\Config;
use App\Core\ForbiddenException;
use App\Core\RateLimitException;
use App\Core\Request;
use App\Core\Response;
use App\Core\UnauthorizedException;
use App\Credits\CreditService;
use App\Credits\InsufficientCreditsException;
use App\Credits\TariffService;
use App\Config\HeartConfig;

/**
 * Route registration for the metalgym88 heart (data sync endpoints, T6a).
 *
 * Install: one line in public/index.php after the router is built —
 *   \App\Heart\Opengym\OpengymModule::registerRoutes($router);
 *
 * Heart convention (same as GET /credits/balance): in production the ?heart=
 * parameter is IGNORED and the install's own heart applies (deploy metalgym88
 * with HEART_ID=<gym heart slug>); in development the parameter is accepted so
 * single-machine multi-heart testing keeps working.
 *
 * Contract authority is the FRONT (src/store/sync.js + useStore.js):
 * - GET answers {"state": <blob>} at the TOP LEVEL of the body (the client's
 *   unwrapBlob reads raw.state); {"state": null} means "no mirror yet" and the
 *   client correctly keeps its local copy.
 * - PUT accepts {"state": <object>, "heart": "..."} and answers {ok:true}.
 * - 404/501/4xx/network are all tolerated by the client as "keep local + dirty",
 *   so precise validation codes still matter for diagnosability only.
 */
final class OpengymModule
{
    public const HEART_SLUG = 'metalgym88';

    public static function registerRoutes($router): void
    {
        $router->register('GET', '/opengym/data', self::respond(static function (Request $request): void {
            $user = AuthMiddleware::requireUser($request);
            self::assertHeart($request);
            $userId = (string) $user['id'];

            $blob = DocumentStore::read($userId);
            Response::json(['state' => $blob]);
        }));

        $router->register('PUT', '/opengym/data', self::respond(static function (Request $request): void {
            $user = AuthMiddleware::requireUser($request);
            $userId = (string) $user['id'];

            $payload = $request->json();
            if (!is_array($payload)) {
                throw new \InvalidArgumentException('El cuerpo debe ser un objeto JSON.');
            }
            self::assertHeartFromBody($payload);

            $state = $payload['state'] ?? null;
            if (!is_array($state) || (count($state) > 0 && array_is_list($state))) {
                throw new \InvalidArgumentException('El campo "state" debe ser un objeto (documento de estado), no un arreglo ni un escalar.');
            }

            $maxBytes = (int) Config::get('opengym.max_state_bytes', 5 * 1024 * 1024);
            $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($encoded === false || strlen($encoded) > $maxBytes) {
                throw new \InvalidArgumentException('El estado excede el tamaño máximo permitido.');
            }

            $bytes = DocumentStore::write($userId, $state);
            Response::json(['ok' => true, 'bytes' => $bytes]);
        }));

        $tariffs = new TariffService();
        $credits = new CreditService();
        $router->register('POST', '/opengym/ai', self::respond(static function (Request $request) use ($tariffs, $credits): void {
            $user = AuthMiddleware::requireUser($request);
            $userId = (string) $user['id'];

            $payload = $request->json();
            if (!is_array($payload)) {
                throw new \InvalidArgumentException('El cuerpo debe ser un objeto JSON.');
            }
            $heartId = self::heartIdFor($payload['heart'] ?? null);

            // Flat response on purpose: the front's classify() reads
            // {answer, conversation_id, balance, operation_id} (top level).
            Response::json(Assistant::ask(
                $userId,
                $heartId,
                is_scalar($payload['question'] ?? null) ? (string) $payload['question'] : '',
                is_scalar($payload['conversation_id'] ?? null) ? (string) $payload['conversation_id'] : null,
                $tariffs,
                $credits
            ));
        }));
    }

    /**
     * Same exception→JSON mapping as the platform's $respond wrapper (this module
     * ships standalone, so it carries its own minimal copy; keep both in sync with
     * public/index.php when new exception kinds appear). Mapping ORDER matters:
     * specific kinds first, Throwable last.
     */
    private static function respond(callable $handler): callable
    {
        return static function (Request $request) use ($handler): void {
            try {
                $handler($request);
            } catch (UnauthorizedException $e) {
                Response::json(['success' => false, 'error' => ['code' => 'UNAUTHORIZED', 'message' => $e->getMessage()]], 401);
            } catch (ForbiddenException $e) {
                Response::json(['success' => false, 'error' => ['code' => 'FORBIDDEN', 'message' => $e->getMessage()]], 403);
            } catch (InsufficientCreditsException $e) {
                Response::json(['success' => false, 'error' => ['code' => 'INSUFFICIENT_CREDITS', 'message' => $e->getMessage()]], 402);
            } catch (RateLimitException $e) {
                Response::json(['success' => false, 'error' => ['code' => 'RATE_LIMITED', 'message' => $e->getMessage()]], 429);
            } catch (NotConfiguredException $e) {
                // 501 = "feature not available yet" for the front's classify()
                // — the gentle pre-availability state, never a user error.
                Response::json(['success' => false, 'error' => ['code' => 'NOT_CONFIGURED', 'message' => $e->getMessage()]], 501);
            } catch (BrainException $e) {
                \App\Core\AppLog::error('opengym', 'brain failed', ['error' => $e->getMessage()]);
                // Same empathetic contract as the platform chat: no charge, no scare.
                Response::json(['success' => false, 'error' => ['code' => 'BRAIN_UNAVAILABLE', 'message' => 'No pudimos generar una respuesta en este momento. Lo siento, la IA no pudo procesar tu consulta ahora. Por favor, inténtalo nuevamente en unos minutos. No se te cobró nada por este intento.']], 502);
            } catch (\InvalidArgumentException $e) {
                Response::json(['success' => false, 'error' => ['code' => 'VALIDATION_ERROR', 'message' => $e->getMessage()]], 400);
            } catch (\Throwable $e) {
                \App\Core\AppLog::error('opengym', 'request failed', ['error' => $e->getMessage()]);
                Response::json(['success' => false, 'error' => ['code' => 'SERVER_ERROR', 'message' => 'No pudimos completar tu solicitud en este momento.']], 500);
            }
        };
    }

    /**
     * Heart resolution for heart-scoped wallet/tariff operations, following the
     * platform convention verified in GET /credits/balance: production uses the
     * install's HEART_ID and ignores client-sent hearts; development accepts a
     * well-formed param so multi-heart testing keeps working on one machine.
     *
     * @param mixed $candidate
     */
    private static function heartIdFor($candidate): ?string
    {
        $install = HeartConfig::createFromEnv()->getHeartId();
        if (Config::get('app.env') !== 'development') {
            return $install;
        }
        $param = trim(is_scalar($candidate) ? (string) $candidate : '');
        if ($param !== '' && preg_match('/^[a-z0-9_-]{1,64}$/', $param) === 1) {
            return $param;
        }
        return $install;
    }

    private static function assertHeart(Request $request): void
    {
        if (Config::get('app.env') !== 'development') {
            return; // production: the install heart applies; the param is advisory.
        }
        $candidate = trim((string) $request->query('heart', ''));
        if ($candidate !== '' && preg_match('/^[a-z0-9_-]{1,64}$/', $candidate) !== 1) {
            throw new \InvalidArgumentException('El parámetro heart no es válido.');
        }
    }

    /** @param array<string, mixed> $payload */
    private static function assertHeartFromBody(array $payload): void
    {
        if (Config::get('app.env') !== 'development') {
            return;
        }
        $candidate = trim((string) ($payload['heart'] ?? ''));
        if ($candidate !== '' && preg_match('/^[a-z0-9_-]{1,64}$/', $candidate) !== 1) {
            throw new \InvalidArgumentException('El campo heart no es válido.');
        }
    }
}
