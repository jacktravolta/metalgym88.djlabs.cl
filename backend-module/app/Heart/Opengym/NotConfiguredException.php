<?php

declare(strict_types=1);

namespace App\Heart\Opengym;

/**
 * The feature exists but the install hasn't priced/enabled it yet (no
 * gym_ai_chat tariff row, or opengym.ai_enabled off). Maps to HTTP 501 —
 * which the frontend classifies as "assistant not available yet" (gentle,
 * pre-availability state), never as a user error.
 */
final class NotConfiguredException extends \RuntimeException
{
}
