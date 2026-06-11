# job-autofill · extensión de navegador

Rellena candidaturas de empleo **en cualquier ATS** con IA (Gemini 3.5 Flash),
directamente en la página donde ya estás logueado. Escanea el formulario, genera
las respuestas y las rellena. **Nunca envía**: tú revisas, adjuntas el CV y pulsas Enviar.

## Instalar (modo desarrollador)

**Chrome / Chromium / Edge / Brave**
1. `chrome://extensions` → activa *Modo de desarrollador*.
2. *Cargar descomprimida* → selecciona la carpeta `extension/`.

**Firefox**
1. `about:debugging#/runtime/this-firefox` → *Cargar complemento temporal*.
2. Selecciona `extension/manifest.json`. (Temporal: se borra al cerrar Firefox.)

## Configurar (una vez)
Click derecho en el icono → *Opciones* (o botón **Ajustes** del popup):
- **API key de Gemini** — pega una key **nueva** de Google AI Studio.
- **Perfil (JSON)** — viene prerrellenado con tus datos; completa salario y teléfono.
- **CV (texto)** — pega el texto de tu CV (la IA redacta cover letters desde aquí).

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
- La key y el perfil se guardan solo en `chrome.storage.local` de **tu** navegador.
- La key **no está en el código** (no acaba en git). La llamada a Gemini sale del
  *service worker*, no de la página, así el sitio web nunca la ve.
- El content script es **pasivo**: solo lee la página cuando pulsas el botón.

## vs. la versión Python (`../`)
- **Extensión**: cualquier ATS, usa tus logins, no sube el CV. Mejor para el día a día.
- **Python/Playwright**: sí sube el CV y lee la oferta por API, pero es más aparatoso.
Son complementarias.
