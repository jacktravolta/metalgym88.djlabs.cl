# Chat: media incrustada, panel compacto, nombre y títulos cortos

> **Estado: autorizado por el owner.** Un solo escritor, dos unidades de trabajo.

## Objetivo

1. El chat **nunca** muestra una URL pelada.
2. Una imagen del modelo se ve **incrustada**, con pie corto ("Figura 1").
3. Un enlace que no es imagen se ve como **enlace**, y abre en otra ventana.
4. La **voz no pronuncia URLs**.
5. La lista de conversaciones vive en una **pestaña minimizable**; los dos
   botones de acción son más pequeños.
6. El chat **reconoce el nombre** de la persona desde el primer prompt.
7. Los títulos de conversación son **cortos**; el saludo automático no es un
   nombre de chat.

## La evidencia (qué está roto hoy)

- `src/components/Assistant.jsx:167` renderiza `{m.text}` como texto plano: una
  URL pegada por el modelo aparece cruda.
- `src/lib/speech.js` (`toSpeechText`) limpia los links markdown
  `[texto](url)` → "texto", pero **no** una URL pelada → la voz la lee.
- `src/lib/coach-threads.js:80` (`deriveThreadTitle`) toma el primer mensaje del
  usuario y lo recorta a 64 caracteres. El mensaje automático del ejercicio es
  "Hola Don Jack, resume el ejercicio “Press de banca” (id 42)…" → el título
  queda con ese texto gigante.
- `src/lib/coach-request.js:44` (`withCoachIdentity`) mete el nombre en el
  `context` de la pantalla, no en el prompt: el modelo no lo usa.
- `src/components/Assistant.jsx:554-590`: la lista de conversaciones y los
  botones "Nueva conversación" / "Eliminar todas las conversaciones" ocupan
  una fila de dos botones de ancho completo.

## Decisiones (ya tomadas, no se re-discuten)

- **Numeración de figuras por respuesta**, no por chat: con un contador global,
  al llegar un mensaje nuevo los pies ya leídos saltarían de número (y durante
  el streaming el número cambiaría bajo los ojos de la persona).
- **El texto de la persona se conserva tal cual** en su bubble. Lo que se
  transforma es la salida del modelo. El nombre viaja en el prompt, no en la
  burbuja.
- **Solo `http` y `https` son enlazables.** `javascript:`, `data:` y `file:`
  nunca se convierten en un `<a>` ni en un `<img>`: se quedan como texto plano.
- El proveedor de la imagen no se inventa: la URL que dio el modelo es la que
  se usa.

## Contrato con la API (no cambia)

`POST {assistant}` → `{ question, conversation_id, heart, context? }`. El
"prompt" es `question`.

## Tareas

### Unidad 1 — la media (WU1)

- [ ] **T1 — `src/lib/chat-media.js` (nuevo)**: el parser puro.
      `parseChatMedia(text)` → segmentos `[{ type: 'text' | 'image' | 'link', … }]`.
      - `![alt](url)` → segmento `image` con su `alt`.
      - `[texto](url)` → segmento `link` (el texto del link es el rótulo; si no
        hay texto útil, el rótulo es "Enlace").
      - URL pelada → `image` si la extensión es de imagen
        (`.png .jpg .jpeg .gif .webp .svg .avif .bmp`), si no `link`.
      - Solo `http/https`: el resto queda como texto.
      - El texto conserva sus saltos de línea.
      - `figure` = el número de figura (1, 2, 3…) **dentro de la respuesta**.
      - Exporta también el host del enlace (`hostOf(url)`) para el rótulo.
- [ ] **T2 — `src/components/Assistant.jsx` (la burbuja)**: renderiza los
      segmentos. Una imagen → `<figure>` con `<img loading="lazy" decoding="async">`
      y `<figcaption>` ("Figura 1"). Si la imagen no carga (`onError`), cae a un
      enlace honesto, nunca a un ícono roto. La figura se puede abrir en otra
      pestaña. Un enlace → `<a target="_blank" rel="noopener noreferrer">` con
      el rótulo y el host al lado (no la URL completa).
- [ ] **T3 — `src/lib/speech.js`**: `toSpeechText` **deja de pronunciar las
      URLs**: una URL de imagen → "imagen", una URL de enlace → "enlace". El
      texto visible y el texto hablado siguen describiendo lo mismo.
- [ ] **T4 — `src/locales/es.js`**: las llaves nuevas (pie de figura, rótulo
      del enlace, aviso de imagen no cargada). Sin español = test de locales
      rojo.
- [ ] **T5 — tests**: `src/lib/chat-media.test.js` (nuevo) y
      `src/lib/speech.test.js` (extendido). vitest, node, lógica pura: **no**
      hay jsdom ni testing-library en este repo, y no se agrega ninguno.

### Unidad 2 — el panel, el nombre y los títulos (WU2)

- [ ] **T6 — `Assistant.jsx`: la lista en una pestaña minimizable.** La lista
      de conversaciones pasa a un acordeón ("Conversaciones (N)") que se abre y
      se cierra. Los dos botones de acción quedan **siempre visibles** y
      **más pequeños**: botones de icono (~26px) con `aria-label` y `title`, a la
      derecha de la pestaña. El destructivo sigue preguntando antes.
- [ ] **T7 — el nombre en el primer prompt** (`src/lib/coach-request.js`):
      una función pura `withPersonIntro(question, user)` que introduce el
      nombre **una sola vez por conversación** (el primer prompt), y solo si la
      pregunta todavía no lo menciona. La **burbuja** del usuario sigue
      mostrando sus palabras, sin el prefijo. `Assistant.jsx` la usa cuando la
      conversación todavía no tiene id.
- [ ] **T8 — los títulos** (`src/lib/coach-threads.js`): `deriveThreadTitle`
      deja de producir texto gigante: quita el saludo inicial ("Hola X,",
      "Hi X,"), corta en la primera frase y topsa corto. Y el hilo creado desde
      la pantalla de ejercicio se titula **con el nombre del ejercicio**
      (`upsertCoachThread` ya acepta un `title` explícito: hay que pasarlo).
- [ ] **T9 — `src/locales/es.js`**: las llaves nuevas de la unidad 2.
- [ ] **T10 — tests**: `coach-request.test.js` y `coach-threads.test.js`
      (extendidos) para la presentación del nombre y los títulos.

## Criterios de aceptación

- Una respuesta con `https://cdn…/press.jpg` se ve como una imagen con pie
  "Figura 1"; **no** aparece la URL.
- Una respuesta con `https://ejemplo.com/articulo` se ve como "Enlace
  ejemplo.com" y abre en otra pestaña.
- Una respuesta con `![Press](https://…jpg)` se ve como imagen con su `alt`.
- Una URL con `javascript:` se queda como texto: nunca es clicable.
- El botón de voz **no** pronuncia ninguna URL.
- El nombre viaja en el primer prompt de la conversación y **no** vuelve a
  aparecer en los siguientes.
- El hilo creado desde la pantalla de ejercicio se llama con el nombre del
  ejercicio, no con el saludo gigante.
- La lista de conversaciones se minimiza y los dos botones son más pequeños.
- Todas las llaves nuevas están en `es.js`.

## Verificación

- `npx vitest run` — la suite completa en verde.
- `npx vite build` — build limpio.
- El chat real con imágenes **no se puede verificar sin una sesión con
  créditos** en este entorno: se reporta así, sin inventar evidencia.

## Ruta

- Un escritor delegado, rama `feat/chat-media-and-panel`, base
  `feat/multi-currency-front` (después de que el escritor de multi-moneda
  suelte `src/locales/es.js`). Dos commits (WU1, WU2). Sin push.

## Progreso

_(lo actualiza el escritor al cerrar cada tarea, con el resultado observado y
el id del commit)_

## Espejo en Engram

- Topic: `odd/chat-media-and-panel/tasks`
- **PENDIENTE**: Engram no confirma el registro de sesión (`mem_save` falla con
  "could not confirm Engram session registration"). El archivo local manda.

## Siguiente paso

_(abierto)_
