# Cierre de la monetización y el pulido de metalgym88 (sesión 2026-11-22 → 2026-11-23)

**Estado:** el dueño pidió parar ("llega hasta acá"). Todo lo que estaba en
marcha queda depositado, verificado y documentado aquí para retomar sin
repetir trabajo.
**Dominio vivo bajo prueba:** `https://metaigym88.djlabs.cl/` (el repositorio se
llama `metalgym88`; el dominio, `metaigym88`).
**RDD:** apagado por decisión global del dueño → no se lanza revisión nativa.

## Objetivo de la sesión

1. Que el correo de cada producto lleve **siempre su propia marca** (emblema,
   skin, asunto y firmante), no la de la plataforma.
2. Que la **pasarela real cobre solo en metalgym88**; el resto de corazones
   sigue en proveedor fake/dev.
3. Que el **login esté dentro del index** (sección `#login`) y "Entrar al
   panel" lleve a esa sección.
4. Que el **coach enlace a los ejercicios del catálogo**.
5. Una **prueba full CDP** que recorra el producto como una persona real.

## Qué está VIVO y verificado

| Qué | Evidencia |
|---|---|
| Login inline en el index | PR #4 **mergeado** (merge `9b99aad`, 2026-11-13) y desplegado. Ancla `href="#login"` (la landing se sirve como `index.html`, fuera del hash) y el destino del panel sale de `appRootPath()` (`src/lib/platform/app-root.js`), no de una ruta escrita a mano. 369 tests verdes, build limpio, capturas en `artifacts/landing-login/`. |
| Logo/emblema en los correos | `471a6e6` (en `feat/panel-modulos`) y `6840fc8` (en `fix/metalgym88-mail-logo`), ambos pusheados. `AuthService` pasa el `$heartId` (9º argumento) al mailer; `EmailChannel` propaga `ctx['heart_id']`; banda con emblema 36×36. `resources/brand/metalgym88-logo.png` regenerado desde `public/logo.jpg` (512×512, sha256 `18c75e4c…81ca`). Correo real recapturado: `<img src="https://api.djlabs.cl/brand/logo?heart=metalgym88" …>`. |
| Pagos resueltos por corazón | Código **en producción** (`af8b0ab`, dentro de `feat/mercadopago-no-rut` @ `6899034`, la rama desplegada). `PaymentProviderFactory::providerNameFor()` resuelve por corazón; el fake nunca acredita desde un webhook público (`FakePaymentProvider::verifyNotification(..., bool $trusted)`). |
| Agujero de créditos gratis cerrado | Webhook público sin verificar no acredita (500), `/payments/fake/confirm` → 404, `/payments/orders` sin sesión → 401. |
| PR #5 (enlaces del coach) | **CERRADO** y rama borrada (remota y local). Ver "Hallazgo que cambió el plan". |

## Qué está COMMITTEADO pero SIN integrar

### API — `fix/heart-canonicalization` @ `35d5f01` (pusheada en `api.djlabs.cl`)

`fix(mail): the heart is canonicalized and an empty heart falls back` ·
base `feat/mercadopago-no-rut` @ `6899034` · 15 ficheros, **+901/−118**.

- **Una sola normalización**, en el `HeartResolver` que ya existía:
  `normalize() = strtolower(trim()) + charset`, en un método privado.
- **Una política de marca** encima: `resolveBranded()` / `resolveBrandedOrInstall()`
  → un corazón vacío, con espacios, deformado o **inexistente** se resuelve como
  *ausencia* y viste el corazón de la instalación. Nunca se imprime "Noexiste"
  en un correo real.
- El mailer resuelve **una vez** con esa política y con ella construye asunto,
  From, shell y auditoría → el correo **siempre** lleva emblema y skin.
- `app_log.heart_id` ahora lleva el corazón del **envío**: `AppLog::log/debug/
  info/warning/error` aceptan un `?string $heartId` **opcional y final** (la API
  existente no cambia: 203 llamadas posicionales).
- El emblema se dimensiona por asset: `BrandAssets::dimensionsFor()` lee el PNG
  real → metalgym88 36×36, plataforma **36×38** (deformación medida 1137 px → 0).
- Puntos de entrada públicos que pasan por la resolución compartida:
  `/auth/magic-link`, `/auth/register`, `/auth/login`, `/auth/me`, `/auth/verify`,
  `/auth/set-password`, `/auth/reverify/resend`, `/auth/scan-entry`, `/contact`,
  `/opengym/*`, `/credits/balance`, `/credits/movements`, `/usage/summary`.

Verificación real: RED de 9 aserciones en copia prístina → GREEN; `''`,
`'METALGYM88'`, `' noexiste '` y `'  '` caen todos al corazón de la instalación;
`/brand/logo?heart=METALGYM88` → los mismos bytes; suite completa **80 PASS /
18 FAIL contra un baseline de 79/19** (los 18 son de entorno: sin `vendor/`, sin
servidor dev, sin credenciales) → **cero fallos nuevos**. El checkout vivo
**no se tocó** (mismo `git status`, mismo HEAD).

El ledger con la evidencia completa está en el repo de la API:
`odd/tasks/metalgym88-mail-logo.md` (sección "Revisión independiente y cierre").

### Front — `feat/full-human-journey` @ `dc67939` (rama local, se pushea al final)

`test(e2e): the full human journey on the live site` · 3 ficheros, +967/−1:

- `scripts/e2e/scenarios/s10-full-journey.js` — el recorrido de una persona:
  landing → login `#login` → buscar ejercicio → armar plan → coach IA → Ajustes
  → billetera → recarga sin pagar → cierre.
- `scripts/e2e/lib/grant-credits.php` — acreditación de saldo **desde la DB**
  (autorizada por el dueño) con el `CreditService` real:
  `CreditService::credit($userId, 'ADMIN_ADJUSTMENT', $amount, null, 'prueba E2E:
  saldo para el recorrido', [], 'metalgym88')`, resolviendo la ruta de la API por
  `E2E_API_DIR`.
- `scripts/e2e/run.js` — el escenario registrado en la suite.

Cada paso guarda su propia evidencia y la corrida reporta PASS / FAIL / BLOCKED
**honestamente**. El paso del coach **no** se marca BLOCKED por "PR #5 abierto":
en `main` el coach ya resuelve los ejercicios del catálogo (ver abajo), así que
lo que se afirma es que la respuesta trae **tarjetas del catálogo** y que al
pulsar una se llega a la biblioteca filtrada por ese ejercicio.

El ledger de la suite sigue en `odd/tasks/cdp-e2e-and-legal-pages.md`; el
recorrido a velocidad humana ya cerrado en `odd/tasks/human-paced-full-demo.md`
(19/19 pasos PASS el 2026-11-21).

## El recorrido S10: qué se verificó DE VERDAD

Commits del recorrido en `feat/full-human-journey`:
`dc67939` (el escenario) y `eee4861` (los arreglos del harness que salieron de
las corridas). El runner ahora publica `outcome.detail` (la lista de pasos por
escenario) en `report.md`/`report.json`: antes esa información se descartaba.

Corrida real headed (`E2E_HEADFUL=1 node scripts/e2e/run.js --only=S10`) contra
`https://metaigym88.djlabs.cl/`, cinco iteraciones. **Los fallos eran del
harness, no del producto**: cada iteración encontró algo distinto y el arreglo
se aplicó después.

| # | Paso | Veredicto | Evidencia observada en vivo |
|---|---|---|---|
| 1 | Landing | **PASS** | Hero «Tu rutina, tu peso y tu coach»; `#como-funciona · #que-incluye · #creditos · #acceso · #login` presentes; CTA «Entrar al panel» con `href=#login` sin sesión y el clic trae el formulario inline. |
| 2 | Entrar por `#login` | **PASS** | «Envíame un enlace…» → `POST /auth/magic-link` 200 → correo real canjeado por `/auth/verify?token=…` → `GET /auth/me` 200 → home «Hola …» con «100 créditos disponibles». |
| 3 | Buscar ejercicio | **PASS** | «abdominal» → 41 resultados; ficha de «Abdominal Bicicleta Con Banda Elástica» (1 media, 5 tags, «Añadir a mi plan»). |
| 4 | Armar plan | **PASS** | Ejercicio añadido a «Nueva rutina» (toast confirmado), renombrada a «Rutina de prueba S10», listada en el plan. |
| 5 | Coach IA | **PASS** | Grant previo `ADMIN_ADJUSTMENT +60` (100→160) vía `CreditService`; `POST /opengym/ai` 200, 1070 caracteres, en español, menciona el ejercicio; **4 tarjetas del catálogo** bajo la respuesta y clic real → `/#/library?q=Abdominal…` con el ejercicio listado. |
| 6 | Ajustes | **PASS** | Secciones: Cuenta · Tu perfil · Avisos de tu cuenta · General · Durante el entrenamiento · Apariencia · Datos · Consejo. |
| 7 | Billetera | **PASS** | Saldo 155; ledger con `ADMIN_ADJUSTMENT` y `USAGE_DEBIT`. |
| 8 | Recarga sin pagar | **A medias** | Packs 1000/5000/10.000 CLP visibles, Neto 840 + IVA 160 = 1000 CLP, «Pagar en CLP con Mercado Pago», USD deshabilitado («requiere credenciales de PayPal en modo live»). La orden se creó en vivo: `POST /payments/orders/checkout` con Idempotency-Key → **HTTP 202 (PENDING)**. Sin verificar: el `order_id` del body y la navegación a la pasarela. |
| 9 | Cierre | **Sin verificar** | Nunca llegó a ejecutarse limpio. |

Verificación del código: `npm test` → **41 archivos / 577 tests passed**
(re-verificado tras `eee4861`); `npm run build` → verde (solo el warning
preexistente de chunks > 1500 kB).

**Lo que NO está verificado** (sin PASS inventado):

- **No hay corrida completa en verde**: los arreglos del harness (aceptar el 202
  del checkout, el constructor `ScenarioFailure`, la espera del editor de rutina)
  están commiteados en `eee4861` pero **no se re-ejecutaron en vivo**.
- No se corrió la suite completa headed S1–S10 (solo `--only=S10`).
- **No se pagó** (ni se intentó): la pierna de pago queda como «necesita tarjeta
  humana».
- Dato observado, no defecto: el coach cobró **5 créditos** por la pregunta
  (160→155), no los 8 del brief; lo que la plataforma sirve manda.

**Defectos de producto confirmados: ninguno.** La sospecha inicial (raíl CLP
muerta por `expectedProvider='mercadopago'` frente a Flow) queda **retirada**:
el «no disponible» del run 1 era la quote aún cargando.

Capturas: `artifacts/e2e/screenshots/s10-01-landing.png` … `s10-08-topup-options.png`
(+ `s10-stepN-fail/blocked.png` de las iteraciones). Informes:
`artifacts/e2e/report.md` y `artifacts/e2e/report.json`.

**Siguiente paso único**: `E2E_HEADFUL=1 node scripts/e2e/run.js --only=S10`
con `eee4861` para cerrar los pasos 8 y 9. Si el body del 202 no expone un
`order_id` legible por CDP, basta con registrar el 202 + Idempotency-Key como
evidencia del contrato y la navegación por `currentUrl()`.

## Hallazgo que cambió el plan: PR #5 era OBSOLETO

Al intentar refrescar PR #5 sobre `origin/main` (10 días después) apareció el
conflicto real: **`main` ya implementa lo que ese PR pedía**, con otro diseño y
garantías más fuertes:

- `src/lib/coach-exercises.js` → `resolveExercises(question)` resuelve los
  ejercicios del **catálogo** que encajan con la pregunta, `exerciseCards()`
  produce las tarjetas y `buildExerciseArtifact()` arma el contexto acotado
  (4 ejercicios, 200 caracteres por línea, 1.200 en total).
- `src/components/Assistant.jsx` (~línea 551) → `openExercise = card => nav(card.link)`
  lleva a la biblioteca filtrada por ese ejercicio; `src/views/Library.jsx` lee
  ese query (`q`).
- La regla que sostiene el código: **las tarjetas salen del catálogo, nunca del
  texto del modelo** (el modelo no puede inventar un ejercicio).

El PR #5 hacía lo contrario: linkificar el texto del modelo con matching difuso,
que puede apuntar al ejercicio equivocado o a uno inexistente. Por eso el
razonamiento del cierre quedó escrito en el propio PR antes de cerrarlo, para
que nadie lo mergee a ciegas.

## Estado REAL de la pasarela (config viva, `config/config.php`, no versionada)

```text
payments.provider            = flow
payments.fake                = false
payments.provider_by_heart   = { ley_datos_21719 => fake, atscv => mercadopago }
payments.fake_in_production_hearts = { ley_datos_21719, atscv }
payments.rails_by_heart      = { metalgym88 => { CLP => mercadopago, USD => paypal } }
```

Cómo resuelve `PaymentProviderFactory::providerNameFor()` (orden real del
código): `provider_by_heart[corazón]` exacto → comodín `'*'` → global; y para
la moneda, `rails_by_heart[corazón][moneda]` → proveedor por defecto global.

**Riesgo abierto que hay que decidir (NO se cambió nada):** con `payments.fake
= false` y sin entrada propia, un corazón que no aparece en `provider_by_heart`
(`cotizaia`, `djlabs.cl`, `leylaboral`, `hosting`) cae al **proveedor global
real** (`flow`), no al fake. `atscv` aparece con `mercadopago` en
`provider_by_heart` pero está en `fake_in_production_hearts`: `usesFakeFor()`
mira primero la entrada explícita, así que **atscv cobra de verdad**; y
`ley_datos_21719` sí queda en fake (entrada explícita + permiso de producción).
Si la intención del dueño sigue siendo "solo metalgym88 cobra de verdad", falta
una entrada explícita para esos corazones (`'*' => 'fake'` o por corazón).
Esto es una decisión del dueño sobre su config en curso: se documenta, no se
toca.

**Verificaciones en vivo que quedan pendientes** (ninguna es destructiva):

1. `POST` al webhook público con un token `FAKE-*` → no acredita (500).
2. Una orden de metalgym88 → qué proveedor responde (hoy la config dice
   Mercado Pago en CLP y PayPal en USD, no Flow).
3. `GET /payments/fake/confirm` → 404 en producción.

**El nombre "Don Jack Labs" que ve la persona al pagar NO es código**: es el
nombre del comercio configurado en la cuenta del dueño (Flow/MercadoPago). Se
cambia en su panel, o creando un comercio propio de metalgym88.

## Decisiones del dueño que ya están tomadas (no se vuelven a preguntar)

- El logo del correo es el de la web (`public/logo.jpg`), "arreglado de una vez
  por todas".
- La pasarela real solo cobra en metalgym88.
- El form de login **sigue desacoplado** y además vive como sección del index.
- "Siempre la marca de su corazón": cada producto lleva SIEMPRE su propia
  marca en sus correos.
- Flow/Mercado Pago solo con credenciales reales; nunca volver a `fake` en
  producción sin cerrar el agujero.
- En la prueba full se puede acreditar saldo **desde la DB** (lo autorizó el
  dueño), porque la pasarela real ya está integrada y no se puede pagar con
  tarjeta en un test.
- **No** se quiere un LLM por corazón: el rotador central de IA se queda central
  para todos los corazones.

## Pendientes, con dueño

| # | Pendiente | Quién |
|---|---|---|
| 1 | Commitear el trabajo sin commitear de Hosting en el checkout vivo de la API y después `git merge fix/heart-canonicalization` (las zonas no se solapan: `HeartSettingStore.php`, `HtmlEmailShell.php`, `public/index.php`). | Dueño (su trabajo) + padre |
| 2 | Decidir el tamaño: +901 líneas > presupuesto de 400 → `size:exception` o trocear en tres commits en la misma rama (canonicalización+política / proporción del emblema / doc). | Dueño |
| 3 | Tras el merge, enviar un correo real y comprobar `app_log.heart_id = 'metalgym88'` (única prueba que necesita producción). | Padre |
| 4 | Resolver la config de `provider_by_heart` para que solo metalgym88 (y lo que el dueño decida de atscv) cobre de verdad. | Dueño |
| 5 | Renombrar el comercio en el panel de la pasarela (o crear uno propio de metalgym88). | Dueño |
| 6 | Revisar el disco: está al **90 %** (3,9 GB libres) antes de la corrida headed con capturas. | Dueño |
| 7 | Verificación en vivo del webhook fake, la orden por corazón y `/payments/fake/confirm`. | Padre |

## Gotchas del entorno (para retomar sin tropezar)

- La API se sirve desde `/home/test/test/api-independent` con
  `php -S 127.0.0.1:8098 -t public` + Cloudflare → `api.djlabs.cl`. `php -S`
  **relee los ficheros por request**: un cambio de código es producción
  inmediata. Relanzar **desanclado**:
  `setsid nohup php -S 127.0.0.1:8098 -t public > /tmp/opencode/api-8098.log 2>&1 &`
  (con `nohup` a secas muere con el grupo del shell).
- El checkout vivo de la API está en `feat/mercadopago-no-rut` @ `6899034` **con
  trabajo sin commitear del dueño** (`app/Core/Response.php`,
  `app/Credits/TariffService.php`, `app/Notify/HeartSettingStore.php`,
  `app/Notify/HtmlEmailShell.php`, `public/index.php` y nuevo
  `app/Heart/Hosting/`) → no tocarlo.
- El front tiene su propio trabajo en curso en `feat/mercadopago-live-purchase`
  @ `84f8cc3` (untracked `capturas/`, `.codegraph/`) → no tocarlo; todo lo nuevo
  va en worktrees.
- En los worktrees del front, `node_modules` es un **symlink** y no lo cubre el
  patrón `node_modules/` del `.gitignore`: está excluido a mano en
  `.git/info/exclude` para que nadie lo commitee.
- **Engram no admite escrituras** (`could not confirm Engram session
  registration`): este fichero es la copia de registro.
- Proveedor de modelos: solo queda `nvidia`;
  `nvidia/deepseek-ai/deepseek-v4.1-flash` devuelve **HTTP 410 Gone** aunque el
  registro lo liste como activo. Rotación en uso: `step-5-preview` (API) y
  `glm-5.3-flash` (front).
- El coach tarda 8–20 s (meta-ai) y consume 8 créditos por `chat_simple`: en la
  prueba full hay que esperar hasta 60 s y acreditar antes.
- Los escenarios S8 (`s8-credit-burn.js`, opt-in `E2E_ALLOW_SPEND=1`) y S9
  (`s9-paypal-card-sandbox.js`) ya existen; S10 sigue sus convenciones
  (evidencia por paso, capturas, PASS/FAIL/BLOCKED honesto).
- Todos los briefs de `/tmp/opencode` se perdieron en reinicios: las specs van
  inline en el prompt de cada worker.
