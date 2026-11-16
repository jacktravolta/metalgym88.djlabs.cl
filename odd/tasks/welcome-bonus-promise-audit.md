# The welcome-bonus promise, front by front

## Objective

The API now tells the truth about the welcome bonus (`data.welcome_bonus` =
`{ credits_added, already_awarded }`). Every front that shares that API still
promises "100 créditos de bienvenida" **unconditionally**, so a person who
registers a second time is told they just got 100 credits that they already
had. This document says who says what, and what each front has to do.

## The fact behind it

The money is **not** duplicated: the ledger `welcome_bonus_grantees` blocks a
second grant per email, forever. The live database confirms it (read-only
aggregates, no PII):

| Fact | Value |
| --- | --- |
| users with two accounts for one email | 0 |
| users with more than one WELCOME_CREDIT | 0 |
| `welcome_bonus_grantees` rows | 1530 |
| WELCOME_CREDIT transactions | 164 |

So the defect is a **false promise**, not a double payment. The person sees
their 100 credits in the balance and hears "we credited you 100 more" — and
concludes they were overcharged. The API computed the truth and threw it away
at the route; that is fixed (API work unit `dc44dbe`).

## Who promises what

### The registration modal — the false promise (the one that hurts)

Same copy, same template family, in six fronts:

| Front | File | Copy |
| --- | --- | --- |
| metalgym88 | `src/views/Landing.jsx:164` | "Te acreditamos 100 créditos de bienvenida al confirmar tu correo." |
| atscv | `index.html:780` | "Escribe tu nombre, tu correo y una contraseña. Te acreditamos 100 créditos de bienvenida y tu pago sigue activo…" |
| cotizaia | `index.html:604` | idem |
| chatcorporativo | `index.html:799` | idem |
| leylaboral | `index.html:650` | idem |
| controldecarroceria | `asisjud.djlabs.cl/ley-datos/index.html:703` | idem |
| asistente-judicial | `public/ley-datos/index.html:699` | idem |

### The landing pages — marketing, defensible but the same trap

"recibes 100 créditos de bienvenida para empezar", "100 créditos de
bienvenida, sin tarjeta", "Empieza con 100 créditos de bienvenida". True for a
FIRST registration, wrong for a returning person who reads it as a promise on
every visit. They do not need to change to stop the complaint; the
registration copy does.

### The legal pages — already correct

`asistente-judicial/public/terminos.html:75`,
`controldecarroceria/asisjud.djlabs.cl/terminos.html:74` and
`metalgym88.djlabs.cl/public/legal/terminos.html:327` already say
"**una sola vez** por correo, de por vida". No change needed.

## The rule for every front

The API is shared by atscv, leylaboral, cotizaia, chatcorporativo, hosting,
ley_datos_21719 and metalgym88, so the contract is the same everywhere:

- `data.welcome_bonus.credits_added > 0` → those credits just arrived: say so.
- `data.welcome_bonus.credits_added === 0` and `already_awarded === true` →
  the credits are already there: say that, with no false promise and no guilt.
- `data.welcome_bonus` **absent** (the API does not publish it yet) → do not
  promise 100 credits either; say something true and neutral about the balance
  the person can see.

The metalgym88 front is being fixed with this rule now. The other six fronts
keep working unchanged (the API field is additive), but each one still tells
the false story until it is updated.

## Progress

- [x] API reports the outcome — `api-independent` `dc44dbe`
- [x] metalgym88 front consumes it and tells the truth — in progress
- [ ] atscv, cotizaia, chatcorporativo, leylaboral, controldecarroceria,
      asistente-judicial: one line each, when their owners ask for it

## Next step

Deploy the API (needs explicit authorization), then update the other six
fronts with the same three-way rule.
