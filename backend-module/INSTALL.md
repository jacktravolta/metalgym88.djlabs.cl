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
- (T6b adds the `/opengym/ai` rate-limit entry.)

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
