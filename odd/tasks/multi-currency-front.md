# Front multi-moneda: detectar, elegir y cobrar en la moneda correcta

> **Estado: autorizado por el owner** ("cierra el front de multimoneda"). Las
> credenciales de Lemon Squeezy todavía NO existen: el front debe quedar
> completo y desplegable HOY, sin depender de ellas ni de la API nueva.

## Objetivo

1. La persona ve **qué se detectó** (país) y **en qué moneda** se va a cobrar.
2. Puede **elegir la moneda** (CLP / USD) y todo el monto se actualiza.
3. La opción que el proveedor no puede cobrar se muestra **con honestidad**,
   nunca como si fuera un error de la persona.
4. **Hoy, en producción, la recarga en CLP sigue funcionando exactamente igual**
   aunque la API nueva no esté desplegada y Lemon Squeezy no tenga credenciales.

## La regla (del owner, sin excepciones)

```
país = CL  Y  moneda = CLP   ->  FLOW            (CLP)
en cualquier otro caso       ->  LEMON SQUEEZY   (USD)
```

- Un chileno que elige USD paga por Lemon Squeezy.
- Cualquier persona fuera de Chile paga por Lemon Squeezy en USD.
- La moneda la elige la persona; el país detectado solo fija el **default**.

## El modelo es recarga de créditos, NO suscripción

Una recarga = un pago único. No hay planes mensuales, renovaciones ni estado de
suscripción. El front no muestra ni una palabra de suscripción.

## El contrato con la API (fijado aquí, se implementa en ambos lados)

### `GET /payments/quote?heart=metalgym88` (nuevo, opcional para el front)

```json
{
  "success": true,
  "data": {
    "detected_country": "CL",
    "detected_currency": "CLP",
    "default_currency": "CLP",
    "rate": { "base": "USD", "quote": "CLP", "value": 995.37, "as_of": "2026-11-16T00:02:31Z" },
    "currencies": [
      { "currency": "CLP", "available": true, "min_clp": 1000, "max_clp": 10000, "presets": [1000, 5000, 10000] },
      { "currency": "USD", "available": false, "reason": "El pago en dólares todavía no está disponible.", "variants": [] }
    ]
  }
}
```

Con Lemon Squeezy configurado, la opción USD trae sus **variantes** (Lemon
Squeezy cobra un precio fijo por variante, no un monto libre):

```json
{ "currency": "USD", "available": true,
  "variants": [ { "variant_id": "67890", "price_usd": 10, "credits": 10000, "amount_clp": 10000, "label": "US$10" } ] }
```

### `POST /payments/orders`

```jsonc
// CLP (Flow) — igual que hoy, más la moneda:
{ "amount_clp": 5000, "currency": "CLP", "document_type": 46, "heart": "metalgym88" }

// USD (Lemon Squeezy) — la variante, NUNCA un monto inventado por el cliente:
{ "currency": "USD", "variant_id": "67890", "document_type": 46, "heart": "metalgym88" }
```

El cliente **nunca** manda `price_usd` ni `credits`: los precios y los créditos
de la variante salen de la configuración del servidor.

## Reglas de comportamiento (obligatorias)

1. **Degradación limpia**: si `/payments/quote` falla (404 porque la API nueva
   no está desplegada, error de red, timeout), el front entra en **modo CLP**:
   exactamente el comportamiento de hoy (packs 1000/5000/10000 + monto libre).
   **Una cotización fallida jamás bloquea una recarga que hoy funciona** y jamás
   se le muestra un error a la persona.
2. **La detección no es una jaula**: el país detectado solo fija la moneda
   inicial; la persona puede cambiarla siempre.
3. **Opción no disponible = visible y honesta**: se muestra con el motivo que
   envía el servidor, no se puede seleccionar, y no se blamea a la persona.
4. **USD = lista de variantes** (precio fijo del proveedor), no un campo de
   monto libre. **CLP = packs + monto libre** (como hoy).
5. Los créditos de una variante USD vienen del servidor (`credits`).
6. El botón dice el monto y la moneda: "Agregar 10.000 CLP en créditos" /
   "Agregar US$10 en créditos".
7. El **nombre del proveedor nunca aparece** en la UI: el front sigue siendo
   agnóstico al proveedor (Flow / Lemon Squeezy).
8. La **idempotencia** se mantiene: una clave por intento de recarga; los
   reintentos de red dentro del mismo intento reutilizan la clave. Cambiar de
   moneda o de monto es un intento nuevo → clave nueva.
9. Tono: sin urgencia, sin culpa, sin presión comercial. "No está disponible
   ahora" es un dato, no una falla.

## Lo que ya existe (no hay que reinventarlo)

- `src/lib/platform/wallet.js` — `normalizeLimits`, `fetchLimits`,
  `clampAmount`, `createOrder(amountClp, {documentType, genKey})` (con el
  retry de red y la misma `Idempotency-Key`), `openPaymentTab`, `goToPayment`,
  el breadcrumb `TOPUP_RECORD_KEY`, `checkReturnedTopUp`, `checkTopupOrder`.
- `src/components/Wallet.jsx` — el panel: saldo, packs CLP, monto libre,
  límites, botón, `TopUpWaitSheet`, `TopUpStatusSheet`, `openWallet()`.
- `src/locales/es.js` — el pack de español. **El test `src/lib/locales.test.js`
  es estricto**: toda llave `t('...')` nueva debe estar en `es.js`.
- `src/lib/platform/wallet.test.js` — los tests del módulo (vitest, entorno
  node, sin jsdom: **solo lógica pura**, sin render de componentes).

## Tareas

- [x] **T1 — `wallet.js`: la cotización.** `normalizeQuote(data)` → una forma
      interna canónica; `fetchQuote()` (tolerante: devuelve `null` si la API no
      tiene el endpoint o falla); `formatMoney(amount, currency)`.
      `normalizeQuote` acepta la forma fijada arriba y también la forma
      `options: [...]` de la primera versión del contrato (robustez: la API
      puede llegar con cualquiera de las dos).
- [x] **T2 — `wallet.js`: la orden por moneda.** `createOrder` acepta la
      moneda: CLP → `{ amount_clp, currency: 'CLP', ... }`; USD →
      `{ currency: 'USD', variant_id, ... }` **sin `amount_clp`**. La clave de
      idempotencia y el retry de red se conservan intactos.
- [x] **T3 — `Wallet.jsx`: la UI de moneda.** Al abrir la billetera se pide la
      cotización; se muestra el país detectado, el selector de moneda y el
      monto de la moneda elegida (packs/monto libre en CLP; lista de variantes
      en USD). Sin cotización → modo CLP, sin cambios visibles.
- [x] **T4 — `src/locales/es.js`**: el copy nuevo, en español neutro, con el
      tono del producto.
- [x] **T5 — `src/lib/platform/wallet.test.js`**: los tests de la lógica nueva
      (normalización, degradación a CLP, cuerpo de la orden por moneda,
      formato de dinero). El test que fija el cuerpo exacto de la orden CLP se
      actualiza **a propósito** (ahora incluye `currency`).

## Criterios de aceptación

- Con la API actual en producción (sin `/payments/quote`), la recarga en CLP
  se comporta **exactamente** como hoy: mismos packs, mismo monto libre, mismo
  botón, misma orden.
- Con una cotización que ofrece CLP y USD no disponible, la persona ve ambas,
  puede elegir CLP, y la de USD aparece con el motivo del servidor.
- Con una cotización que ofrece USD con variantes, la persona elige una
  variante y la orden manda `variant_id` (sin monto).
- El nombre del proveedor no aparece en ninguna cadena de la UI.
- Todas las llaves nuevas están en `es.js` y el test de locales pasa.

## Verificación

- `npx vitest run` — la suite completa en verde.
- `npx vite build` — build limpio.
- `php -l` no aplica (esto es front).
- El flujo real con Lemon Squeezy **no se puede probar todavía**: no hay
  credenciales ni hay API desplegada. Se reporta así, sin inventar evidencia.

## Ruta

- Un escritor delegado (4 archivos no triviales) sobre la rama
  `feat/multi-currency-front`, un commit por unidad de trabajo, sin push.

## Progreso

- **T1 — cerrada en `68ad668`** (`feat(wallet): add tolerant multi-currency quote support`).
  `normalizeQuote` acepta `currencies[]` y `options[]`, rechaza datos inválidos,
  `fetchQuote` degrada a `null` ante 404 o error de red y `formatMoney` distingue
  CLP entero de USD con dos decimales. Verificación focalizada observada:
  `npx vitest run src/lib/platform/wallet.test.js` → 1 archivo / 37 tests en verde.
- **T2 — cerrada en `8d0d88e`** (`feat(wallet): create orders in the selected currency`).
  El cuerpo CLP ahora incluye `currency: 'CLP'`; el cuerpo USD incluye
  `variant_id` y no incluye `amount_clp` ni créditos inventados. La clave de
  idempotencia y el mismo cuerpo se reutilizan en los reintentos de red de ambas
  rutas. Verificación focalizada observada:
  `npx vitest run src/lib/platform/wallet.test.js` → 1 archivo / 39 tests en verde.
- **T3 — cerrada en `f8fe62f`** (`feat(wallet): add currency selection to the recharge panel`).
  La billetera consulta la cotización al abrirse, muestra el país detectado y el
  selector, mantiene los packs y el monto libre para CLP, muestra las variantes
  fijas con precio y créditos para USD y degrada en silencio al flujo CLP actual
  cuando no hay cotización. Verificación observada: `npx vite build` → build
  correcto (137 módulos; solo la advertencia preexistente de chunks > 1500 kB).
- **T4 — cerrada en el commit de cierre** (`chore(i18n): add Spanish copy for currency top-ups`).
  Se añadieron las seis traducciones nuevas de la sección de moneda, en español
  neutro y sin presión comercial. El hash corto de este commit se consigna en el
  informe final de ejecución. Verificación observada:
  `npx vitest run src/lib/locales.test.js` → 1 archivo / 2 tests en verde.
- **T5 — cerrada con los tests entregados junto al comportamiento en `68ad668` y
  `8d0d88e`**. Quedaron cubiertos ambas formas de cotización, datos inválidos,
  degradación por 404 y red, formato de dinero, cuerpos exactos CLP/USD y
  reutilización de la clave idempotente en reintentos USD. El test CLP exacto se
  actualizó a propósito para incluir `currency: 'CLP'`. Verificación final observada:
  `npx vitest run` → 31 archivos / 466 tests en verde, y `npx vite build` → build
  correcto (137 módulos; solo la advertencia preexistente de chunks > 1500 kB).

## Espejo en Engram

- Topic: `odd/multi-currency-front/tasks`
- **PENDIENTE**: Engram no confirma el registro de sesión (`mem_save` falla con
  "could not confirm Engram session registration"). El archivo local es la
  fuente de verdad hasta que Engram vuelva.

## Siguiente paso

_(abierto)_
