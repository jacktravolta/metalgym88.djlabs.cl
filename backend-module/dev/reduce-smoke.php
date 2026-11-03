<?php
// Smoke harness for the reduction layer (stubs App\Core\Config so the pure
// function runs outside the platform). Not installed anywhere — dev-only.
namespace App\Core {
    class Config { public static function get($k, $d = null) { return $d; } }
    class AppLog {
        public static function info(...$a) {} public static function error(...$a) {} public static function warning(...$a) {}
    }
    class Request { public function __construct(readonly public array $q = []) { } public function query($k, $d = null) { return $this->q[$k] ?? $d; } }
    class Response { public static $last = null; public static function json($b, $s = 200) { self::$last = [$b, $s]; } }
    class AuthMiddleware { public static function requireUser($r) { return ['id' => 'u_user123-abc']; } }
    class UnauthorizedException extends \Exception {}
    class ForbiddenException extends \Exception {}
    class RateLimitException extends \Exception {}
}
namespace App\Credits {
    class CreditService {
        public function balance(string $u, ?string $h = null): int { return 100; }
        public function debit(...$a) { return ['balance_after' => 95]; }
    }
    class InsufficientCreditsException extends \Exception {}
    class TariffService { public function creditsFor(string $o, ?string $h = null): ?int { return 5; } }
}
namespace App\Chat {
    class BrainException extends \Exception {}
    interface BrainAdapter {}
    class BrainAdapterFactory { public static function create() { return null; } }
}
namespace { // global: load module classes and run the assertions
    require __DIR__ . '/../app/Heart/Opengym/DocumentStore.php';
    require __DIR__ . '/../app/Heart/Opengym/NotConfiguredException.php';
    require __DIR__ . '/../app/Heart/Opengym/Assistant.php';

    $blob = [
        '_ts' => 1761830400000,
        'settings' => ['units' => 'kg', 'effortScale' => 10],
        'bodyweight' => [['date' => '2026-10-01', 'weight' => 82.4], ['date' => '2026-10-20', 'weight' => 81.2]],
        'routines' => [['name' => 'Full body 3d', 'active' => true,
            'days' => [['exercises' => [[], []]], ['exercises' => [[]]]]]],
        'workouts' => [
            ['date' => '2026-10-28T09:30', 'exercises' => [
                ['name' => 'Press banca', 'sets' => [['reps' => 8, 'weight' => 60], ['reps' => 8, 'weight' => 60], ['reps' => 7, 'weight' => 60]], 'effort' => 7],
                ['name' => 'Sentadilla', 'sets' => [['reps' => 5, 'weight' => 90], ['reps' => 5, 'weight' => 92.5]]],
            ]],
            ['date' => '2026-10-25T18:00', 'exercises' => [['name' => 'Press banca', 'sets' => [['reps' => 8, 'weight' => 57.5]]]]],
        ],
    ];
    $out = \App\Heart\Opengym\Assistant::reduceContext($blob, 10);
    echo "=== REDUCED (", strlen($out), " bytes) ===\n", $out, "\n\n";
    // Assertions: no invented data, key sections present, newest-first order.
    assert(str_contains($out, 'Press banca'));
    assert(str_contains($out, '92.5kg') || str_contains($out, '92,5kg'));
    assert(str_contains($out, 'bajando')); // trend from 82.4 → 81.2
    assert(str_contains($out, 'Full body 3d'));
    assert(str_contains($out, 'AJUSTES DEL USUARIO'));
    assert(strpos($out, '2026-10-28') < strpos($out, '2026-10-25')); // newest first
    // Empty + null users:
    $empty = \App\Heart\Opengym\Assistant::reduceContext(null);
    assert(str_contains($empty, 'no tiene registros'));
    echo "=== reduceContext smoke OK ===\n";
}
