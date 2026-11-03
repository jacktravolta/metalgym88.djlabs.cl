<?php

/**
 * metalgym88 heart — config snippet (T6a). Add these keys to the platform's
 * config/config.php (gitignored, per platform convention) following the
 * cotizaia.* pattern. Keys are read with Config::get('opengym.<key>', default),
 * so every key here is optional — the defaults are production-safe.
 */

return [
    // Where per-user gym state documents live, relative to the project root.
    // Layout: {storage_dir}/{userID}/dataGym.json (server-internal path,
    // never exposed to clients). Default keeps product isolation from other
    // hearts' storage (platform already uses storage/invoices).
    'opengym.storage_dir' => 'storage/opengym',

    // Hard cap for a mirrored state document, in bytes (raw stored size).
    // 5 MB is generous for years of workout history in the opengym blob shape.
    'opengym.max_state_bytes' => 5 * 1024 * 1024,

    // --- AI endpoint (T6b) -------------------------------------------------
    // Kill switch for the metered gym AI Coach. When false (or the
    // gym_ai_chat tariff row is missing), /opengym/ai answers 501 — the
    // frontend's gentle "assistant not available yet" state, never charged.
    'opengym.ai_enabled' => true,

    // Prompt-input budget: how many past sessions the reduction layer
    // renders (newest first), and the total context char cap.
    'opengym.reduction_workouts' => 15,
    'opengym.max_context_chars' => 5000,

    // Question input cap (chars). Answers never count against this.
    'opengym.max_question_chars' => 4000,
];
