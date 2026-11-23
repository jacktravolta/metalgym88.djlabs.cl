<?php
declare(strict_types=1);

/*
 * TEST-side credit grant for the E2E harness (S10, the full human journey).
 *
 * The real recharge is wired to a payment provider: a test can create the
 * order and reach the gateway, but the last leg (paying) needs a human card.
 * The coach consumes credits, so the journey credits the wallet through the
 * PLATFORM'S OWN CODE instead of hand-written SQL — this script is a thin
 * wrapper over App\Credits\CreditService::credit(), the same entry point the
 * admin path uses. No backdoor opens in production: this file lives in the
 * test repo, runs only under a CLI, and writes one ADMIN_ADJUSTMENT ledger
 * row through the platform's transactional service.
 *
 * Usage (the harness calls it exactly like this):
 *   php scripts/e2e/lib/grant-credits.php <email> <amount> <heart>
 *
 * The API codebase is found through E2E_API_DIR (default
 * /home/test/test/api-independent): its autoload and its own config are
 * loaded, so the database the LIVE deployment uses is the one credited.
 *
 * Output: a single JSON object on STDOUT ({"ok":true,...} or {"ok":false,...}).
 * Exit codes: 0 = credited, 1 = the account was not found, 2 = anything else.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only.');
}

// Nothing the platform bootstrap may print may corrupt the JSON contract: the
// harness parses STDOUT, so the bootstrap's output is buffered and dropped.
ob_start();

$apiDir = rtrim((string) (getenv('E2E_API_DIR') ?: '/home/test/test/api-independent'), '/');

/** Prints the final JSON verdict and exits with the given code. */
function finish(array $payload, int $code): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
    exit($code);
}

$email = isset($argv[1]) ? trim((string) $argv[1]) : '';
$amount = isset($argv[2]) ? (int) $argv[2] : 0;
$heart = isset($argv[3]) && trim((string) $argv[3]) !== '' ? trim((string) $argv[3]) : 'metalgym88';

if ($email === '' || $amount <= 0) {
    finish([
        'ok' => false,
        'error' => 'usage: php grant-credits.php <email> <amount> <heart> (amount must be a positive integer)',
    ], 2);
}

if (!is_file($apiDir . '/app/Core/autoload.php') || !is_file($apiDir . '/config/config.php')) {
    finish([
        'ok' => false,
        'error' => 'the API codebase was not found (set E2E_API_DIR): looked for autoload.php and config/config.php under ' . $apiDir,
    ], 2);
}

try {
    require $apiDir . '/app/Core/autoload.php';
    App\Core\Config::load($apiDir . '/config/config.php');
} catch (Throwable $e) {
    finish(['ok' => false, 'error' => 'the API bootstrap failed: ' . $e->getMessage()], 2);
}

try {
    $statement = App\Core\Database::connection()->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
    $statement->execute([':email' => $email]);
    $userId = $statement->fetchColumn();

    if ($userId === false || $userId === null) {
        // The account is never named beyond this JSON: the report redacts it.
        finish(['ok' => false, 'error' => 'no account exists yet for the test inbox (the magic-link sign-in must run first)'], 1);
    }
    $userId = (string) $userId;

    $result = (new App\Credits\CreditService())->credit(
        $userId,
        'ADMIN_ADJUSTMENT',
        $amount,
        null,
        'prueba E2E: saldo para el recorrido',
        [],
        $heart
    );

    finish([
        'ok' => true,
        'amount' => (int) $result['amount'],
        'balance_before' => (int) $result['balance_before'],
        'balance_after' => (int) $result['balance_after'],
        'transaction_id' => (string) $result['transaction_id'],
        'type' => (string) $result['type'],
        'heart' => $heart,
        'idempotent_replay' => (bool) $result['idempotent_replay'],
    ], 0);
} catch (Throwable $e) {
    finish(['ok' => false, 'error' => get_class($e) . ': ' . $e->getMessage()], 2);
}
