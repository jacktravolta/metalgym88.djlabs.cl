<?php

declare(strict_types=1);

namespace App\Heart\Opengym;

use App\Core\AppLog;
use App\Core\Config;

/**
 * Per-user gym state document store for the metalgym88 heart (T6a).
 *
 * Owner model: the client (opengym fork PWA) keeps its localStorage as the source
 * of truth — this store only MIRRORS each user's state blob so the platform's AI
 * assistant (T6b) can read it. The layout under the product namespace is
 * {storage_dir}/{userID}/dataGym.json; the exact base directory is server-internal
 * and never exposed to clients.
 *
 * Design rules:
 * - userID is validated fail-closed (^[A-Za-z0-9_-]+$) — no path traversal.
 * - Writes are atomic (same-directory tmp file + rename) — a crash mid-write can
 *   never leave a half-written blob that the client would then adopt.
 * - No schema: the blob is stored as-is (document store, owner decision #3).
 * - Nothing about the content is ever logged (it carries personal workout data).
 */
final class DocumentStore
{
    private const USER_ID_PATTERN = '/^[A-Za-z0-9_-]{1,128}$/';

    public static function validateUserId(string $userId): string
    {
        if (preg_match(self::USER_ID_PATTERN, $userId) !== 1) {
            throw new \InvalidArgumentException('Identificador de usuario no válido.');
        }
        return $userId;
    }

    public static function baseDir(): string
    {
        $configured = trim((string) Config::get('opengym.storage_dir', 'storage/opengym'));
        return $configured !== '' ? rtrim($configured, '/') : 'storage/opengym';
    }

    public static function userDir(string $userId): string
    {
        self::validateUserId($userId);
        return self::baseDir() . '/' . $userId;
    }

    public static function filePath(string $userId): string
    {
        return self::userDir($userId) . '/dataGym.json';
    }

    /**
     * Returns the stored state blob (decoded) or null when the user has no
     * mirror yet. Corrupted JSON is treated as "no mirror" (client keeps its
     * local copy and re-pushes) and reported to AppLog — never thrown at the user.
     */
    public static function read(string $userId): ?array
    {
        $path = self::filePath($userId);
        if (!is_file($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false) {
            AppLog::error('opengym', 'docstore: unreadable file', ['user_id' => $userId]);
            return null;
        }
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            AppLog::error('opengym', 'docstore: corrupted json', ['user_id' => $userId]);
            return null;
        }
        return is_array($decoded) ? $decoded : null;
    }

    /**
     * Atomically stores the state blob. Returns the stored byte size.
     *
     * @param array<string, mixed> $state
     */
    public static function write(string $userId, array $state): int
    {
        $dir = self::userDir($userId);
        if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
            AppLog::error('opengym', 'docstore: cannot create directory', ['user_id' => $userId]);
            throw new \RuntimeException('No se pudo preparar el almacenamiento del documento.');
        }

        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded === false) {
            throw new \InvalidArgumentException('El estado no es un documento JSON válido.');
        }

        $path = self::filePath($userId);
        $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
        if (file_put_contents($tmp, $encoded, LOCK_EX) === false || !rename($tmp, $path)) {
            @unlink($tmp);
            AppLog::error('opengym', 'docstore: atomic write failed', ['user_id' => $userId]);
            throw new \RuntimeException('No se pudo guardar el documento.');
        }

        return strlen($encoded);
    }
}
