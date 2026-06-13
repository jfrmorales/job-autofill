# job-autofill · extensión de navegador

**Español** · [English](README.en.md)

Rellena candidaturas de empleo **en cualquier ATS** con IA, directamente en la
página donde ya estás logueado. Escanea el formulario, genera las respuestas y las
rellena. **Nunca envía**: tú revisas, adjuntas el CV y pulsas Enviar.

La interfaz está en **español e inglés**: elige idioma en el selector **«Idioma
de la interfaz»** de *Ajustes* (si no, se autodetecta del navegador).

Funciona con **varios proveedores de IA** (elige uno en *Ajustes*):
- **Google** — Gemini / Gemma (Google AI Studio).
- **OpenAI** — GPT-4o / GPT-4.1…
- **Anthropic** — Claude (Haiku / Sonnet / Opus).
- **Compatible con OpenAI (personalizado)** — pega una *Base URL* y cubre
  OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, y modelos **locales** como
  Ollama o LM Studio (`http://localhost:11434/v1`, sin API key).

Cada proveedor guarda su propia API key, así que puedes alternar sin reescribirlas.

## Instalar (modo desarrollador)

**Chrome / Chromium / Edge / Brave**
1. `chrome://extensions` → activa *Modo de desarrollador*.
2. *Cargar descomprimida* → selecciona la carpeta `extension/`.

**Firefox**
1. `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal*.
2. Selecciona `extension/manifest.json`. (Temporal: se borra al cerrar Firefox.)

## Configurar (una vez)
Click derecho en el icono → *Opciones* (o botón **Ajustes** del popup):
- **Idioma de la interfaz** — español o inglés (se guarda en el navegador).
- **Proveedor de IA** — Google / OpenAI / Anthropic / compatible (personalizado).
- **API key** — pega una key **nueva** del proveedor elegido (vacía para servidores
  locales como Ollama). Para «personalizado», indica también la **Base URL**.
- **Modelo** — elige uno de los sugeridos o escribe un id propio. Los modelos de
  razonamiento de OpenAI (`o4-mini`, `o3`…) se detectan y se llaman con los
  parámetros correctos automáticamente.
- **Probar conexión** — hace una petición mínima y te dice si la key, el modelo y
  el endpoint funcionan (sin tener que guardar ni lanzar una candidatura).
- **Respaldo (429)** — si lo activas y el proveedor falla por cuota agotada (429),
  error de servidor (5xx) o **timeout** (el modelo se queda colgado), prueba
  automáticamente con los otros proveedores que tengan API key configurada.
- **Opciones avanzadas** — temperatura, máx. tokens, **timeout por petición** y modo
  JSON (desactívalo si un servidor compatible devuelve error 400 con `response_format`).
  El timeout es de **inactividad** (por defecto 180 s): la respuesta se hace en
  *streaming* y la petición sigue viva mientras lleguen tokens; solo se corta si el
  modelo se queda mudo ese tiempo. Súbelo para modelos lentos (p.ej. Gemma).
- **Perfil (JSON)** — viene prerrellenado con tus datos; completa salario y teléfono.
- **CV (texto)** — pega el texto de tu CV (la IA redacta cover letters desde aquí).

Al guardar un proveedor **personalizado**, el navegador pedirá permiso de red para
ese dominio (la extensión solo trae permiso fijo para Google, OpenAI y Anthropic).

## Usar
1. Abre la oferta y ve a su formulario (pulsa *Apply* si hace falta).
2. Click en el icono → **⚡ Rellenar con IA**.
3. Los campos rellenados se marcan en **verde**; los que fallaron, en **rojo**.
4. **Adjunta tu CV** (el navegador no deja hacerlo por script), revisa y **envía tú**.

### Formularios embebidos (Comeet, Greenhouse iframe…)
Muchos ATS cargan el formulario dentro de un **iframe** (p.ej. Coralogix usa Comeet →
`app.comeet.co`) y a veces solo tras pulsar *Apply*. La extensión:
- Corre en **todos los frames** y escanea el iframe del formulario automáticamente.
- Si no ve campos, intenta abrir el form (clic en *Apply* in-page) y **reintenta** una vez.
- Si aún sale «0 campos»: pulsa tú **Apply**, espera a que cargue el form y dale otra vez.

> Tras actualizar el `manifest.json`, **recarga la extensión** en `chrome://extensions`
> (botón ↻). Chrome pedirá aceptar el permiso nuevo de *webNavigation*.

## Qué rellena
- ✅ Texto, email, teléfono, URLs, textarea (incl. cover letters generadas).
- ✅ `<select>` nativos, radios, checkboxes.
- ✅ Campos de **«Resume» en texto** (p.ej. el textarea de Greenhouse): se rellenan
  con el texto de tu CV, sin gastar IA.
- ⚠️ Comboboxes react-select (Greenhouse/Ashby): *best-effort*, revísalos.
- ❌ Subir el **fichero** del CV: **manual** (restricción del navegador) — pero ver abajo.

## CV siempre a mano
Aunque el navegador no deja adjuntar el fichero por script, el popup te lo deja a un clic:
- **⬇ CV a Descargas** — baja el PDF guardado a tu carpeta de Descargas, listo para
  seleccionar en el campo de subida (que se resalta en **naranja** al rellenar).
- **📋 Copiar CV** — copia el texto del CV al portapapeles (para formularios que piden
  pegar el currículum).
- Carga tu PDF y pega el texto una vez en *Ajustes*; quedan guardados de forma permanente.

## Privacidad / seguridad
- Las keys (una por proveedor) y el perfil se guardan solo en `chrome.storage.local`
  de **tu** navegador.
- La key **no está en el código** (no acaba en git). La llamada al proveedor sale del
  *service worker*, no de la página, así el sitio web nunca la ve.
- El content script es **pasivo**: solo lee la página cuando pulsas el botón.
- Solo se permiten por defecto los dominios de Google, OpenAI y Anthropic; cualquier
  *Base URL* personalizada requiere que tú concedas el permiso de red al guardar.

## vs. la versión Python (`../`)
- **Extensión**: cualquier ATS, usa tus logins, no sube el CV. Mejor para el día a día.
- **Python/Playwright**: sí sube el CV y lee la oferta por API, pero es más aparatoso.
Son complementarias.
