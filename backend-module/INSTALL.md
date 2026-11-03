# INSTALL — metalgym88 backend heart (PARTIAL: data store, T6a)

> Status: **packaged, NOT applied.** Applying anything to the live
> `api.djlabs.cl` requires the owner's explicit go (owner constraint).
> The AI endpoint section arrives with T6b.

These steps are written against the real platform layout (`api.djlabs.cl`,
PHP 8.1+, no framework, routes in `public/index.php`, no Composer).

## 1. Copy the module

```bash
cp -r backend-module/app/Heart/Opengym /home/test/test/controldecarroceria/api.djlabs.cl/app/Heart/
```

The platform autoloader (`app/Core/autoload.php`) maps `App\` → `app/`, so
`App\Heart\Opengym\*` resolves with no composer dump.

## 2. Register the routes

One line in `public/index.php`, next to the other `$router->register(...)` groups:

```php
\App\Heart\Opengym\OpengymModule::registerRoutes($router);
```

## 3. Config keys (optional — defaults are production-safe)

Add to `config/config.php` (gitignored) if you want to deviate:

```php
'opengym.storage_dir' => 'storage/opengym',
'opengym.max_state_bytes' => 5 * 1024 * 1024,
```

## 4. Deployment constraint (READ BEFORE APPLYING)

- Production is **1 install = 1 heart** (per platform deploy notes). metalgym88
  needs its wallet/tariffs/AI under the gym heart: either deploy a dedicated
  install with `HEART_ID=<gym heart slug>` (recommended today), or do the
  platform's real multi-heart production work first.
- The frontend's `window.__API_BASE__` must point at that install, and the
  install's `cors.origins` must include the metalgym88 origin.

## 5. CORS + rate limit

- Add `https://metalgym88.djlabs.cl` to the platform's `cors.origins` exact allowlist.
- The AI endpoint reuses the platform's `chat_user` rate-limit scope with the
  product bucket `opengym_ai:user:<user_id>` — editable from the admin panel
  like the chat limit, no new scope needed (the module does not touch the
  platform's SCOPES const).

## 6. Smoke test (data sync — T6a scope)

```bash
# with the platform running and a registered user session cookie:
curl -s -b cookies.txt https://api.djlabs.cl/opengym/data        # → {"state":null}
curl -s -b cookies.txt -X PUT https://api.djlabs.cl/opengym/data \
  -H 'Content-Type: application/json' \
  -d '{"state":{"_ts":1,"workouts":[1]},"heart":"metalgym88"}'   # → {"ok":true,...}
curl -s -b cookies.txt https://api.djlabs.cl/opengym/data        # → {"state":{"_ts":1,...}}
ls storage/opengym/<user_id>/                                    # → dataGym.json
```

Then from the PWA: sign in → make a workout edit → wait ~2s (debounced push) →
reload → the edit must survive (adopted from the mirror).

## 7. AI endpoint (T6b)

1. **Tariff**: run `migrations/00XX_opengym_init.sql` — it seeds the
   `gym_ai_chat` row (default 5 credits). **The owner tunes the price**; while
   the row is missing or unpriced, /opengym/ai answers 501 and the frontend
   shows the gentle "assistant not available yet" state.
2. **Config keys** (all optional, see `config/opengym.php`):
   `opengym.ai_enabled`, `opengym.reduction_workouts`, `opengym.max_context_chars`,
   `opengym.max_question_chars`, plus the T6a storage keys.
3. **Money order** (mirrors the platform chat): gates → tariff → balance check
   → brain call → debit (`gym_ai:<uuid>`, idempotent like `chat:<uuid>`). A
   brain failure answers 502 with NO charge — the debit only happens after an
   answer exists.
4. **Smoke test (AI)**:
   ```bash
   # seeded tariff + normal operation:
   curl -s -b cookies.txt -X POST https://api.djlabs.cl/opengym/ai \
     -H 'Content-Type: application/json' \
     -d '{"question":"¿Cómo fue mi semana?","heart":"metalgym88"}'
   # → 200 {"answer":"...","conversation_id":"...","balance":95,"operation_id":"..."}
   # check exactly ONE credit_transactions row with operation_id 'gym_ai:<uuid>'
   # without the tariff row:      → 501 {"error":{"code":"NOT_CONFIGURED",...}} (no charge)
   # wallet below the price:      → 402 INSUFFICIENT_CREDITS (no charge, no debit row)
   # brain unavailable:           → 502 BRAIN_UNAVAILABLE (no charge, no debit row)
   ```
5. **Content safety**: the system prompt hardens against prompt injection (the
   document is DATA, never instructions) and the assistant never decides
   saldo/pagos/autorizaciones — the brain only produces text from the reduced
   context. No question/answer content is ever logged (ids and lengths only).
