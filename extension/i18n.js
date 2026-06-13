// i18n.js — internacionalización (español / inglés) COMPARTIDA por el popup,
// la página de Ajustes y el service worker (background.js lo carga con
// importScripts). Es la única fuente de verdad de los textos de interfaz.
//
// El idioma se guarda en chrome.storage.local (`lang`); si no hay nada guardado
// se autodetecta de navigator.language. Cada contexto llama a applyLangFromStore()
// al arrancar y, en HTML, applyI18n() recorre los [data-i18n] del DOM.

const LANGS = ["en", "es"];
let LANG = "en";

function normalizeLang(v) {
  const code = (v || "").toString().trim().toLowerCase().slice(0, 2);
  return LANGS.includes(code) ? code : null;
}

function detectLang(stored) {
  return normalizeLang(stored)
    || normalizeLang(typeof navigator !== "undefined" && navigator.language)
    || "en";
}

function setLang(v) {
  LANG = normalizeLang(v) || "en";
}

function getLang() {
  return LANG;
}

// Lee el idioma guardado (o autodetecta) y lo fija. Devuelve el código.
async function applyLangFromStore() {
  try {
    const { lang } = await chrome.storage.local.get("lang");
    setLang(detectLang(lang));
  } catch {
    setLang(detectLang());
  }
  return LANG;
}

// Texto traducido para `key`, con interpolación de {placeholders}. Cae a inglés
// si la clave falta en el idioma activo.
function t(key, vars) {
  const table = I18N[LANG] || I18N.en;
  let s = table[key];
  if (s == null) s = I18N.en[key];
  if (s == null) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
  return s;
}

// Recorre el DOM y traduce los elementos marcados:
//   data-i18n        -> textContent
//   data-i18n-html   -> innerHTML (para textos con <b>, <code>…)
//   data-i18n-ph     -> placeholder
//   data-i18n-title  -> title
function applyI18n(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  scope.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  if (scope === document && document.documentElement) document.documentElement.lang = LANG;
}

const I18N = {
  en: {
    // --- popup.html ---
    app_title: "job-autofill",
    btn_fill: "⚡ Fill with AI",
    btn_cvdl: "⬇ CV to Downloads",
    btn_cvcopy: "📋 Copy CV",
    btn_scan: "Scan only",
    btn_opts: "Settings",
    btn_showlog: "View log",
    btn_hidelog: "Hide log",
    btn_copylog: "📋 Copy log",
    popup_footer: "Review, attach the CV and <b>submit yourself</b>. The extension never submits.",
    // --- popup.js (dynamic) ---
    run_running: "⏳ Running since {time}…",
    run_error: "✗ Error ({time}): {error}",
    run_done: "✓ Done {time} — {ok} ok",
    run_done_fail: ", {fail} failed",
    run_done_files: ", {files} file",
    scan_zero: "0 fields. Press «Apply» to open the form and retry.",
    scan_result: "Detected {total} fields ({fillable} fillable, {files} file/manual).",
    scan_unreadable: "Couldn't read the page. Is it a normal web tab?",
    working: "Working… you can close this window; it keeps running in the background.",
    error_prefix: "Error: ",
    cv_no_pdf: "No saved PDF. Load it in «Settings».",
    cv_downloaded: "⬇ {name} saved to Downloads; you can attach it now.",
    cv_no_text: "No CV text. Paste it in «Settings».",
    cv_copied: "📋 CV text copied to the clipboard.",
    cv_copy_fail: "Couldn't copy (clipboard permission).",
    log_empty: "No log yet.",
    log_copied: "📋 Log copied to the clipboard.",
    log_copy_fail: "Couldn't copy the log (clipboard permission).",
    config_missing: "⚙ Set up provider, API key and profile in «Settings» first.",
    cv_default: "your CV",
    // --- options.html ---
    opts_title: "job-autofill · Settings",
    opts_keywarn: "🔑 The API key is stored only in <b>this browser</b> (chrome.storage.local) and is used from the background to call the provider you choose. <b>Don't share it</b>. If you exposed it somewhere, regenerate it in the provider's panel.",
    opts_lang_label: "Interface language",
    opts_provider_label: "AI provider",
    opts_apikey_label: "API key",
    opts_baseurl_label: "API Base URL",
    opts_model_label: "Model",
    opts_model_custom_ph: "model id (e.g. llama-3.3-70b)",
    opts_model_help: "Each provider ships suggested models; «Custom…» accepts any valid id for that provider. If you run out of quota on a model, switch model or provider.",
    opts_test_btn: "Test connection",
    opts_fallback_label: "Use other providers (with a key) as a fallback if the quota runs out (429)",
    opts_advanced: "Advanced options",
    opts_temp_label: "Temperature (0–2)",
    opts_temp_help: "Lower = more deterministic answers. Default 0.4.",
    opts_maxtok_label: "Max output tokens",
    opts_maxtok_help: "Raise it if answers get cut off. Default 8192.",
    opts_timeout_label: "Request timeout (s)",
    opts_timeout_help: "Raise it if the model is slow (e.g. Gemma) and requests time out. Default 180.",
    opts_jsonmode_label: "Force JSON mode (<code>response_format</code>)",
    opts_jsonmode_help: "Improves JSON reliability, but some compatible servers reject it: turn it off if it gives a 400 error.",
    opts_profile_label: "Profile (JSON)",
    opts_profile_help: "Name, email, LinkedIn, salary, etc. The AI uses it to fill the fields.",
    opts_cvfile_label: "CV in PDF (for quick download/attach)",
    opts_cvfile_help: "The browser won't let it be attached by script, but the popup downloads it to Downloads with one click so you only have to select it.",
    opts_cvtext_label: "CV (plain text)",
    opts_cvtext_ph: "Filled automatically when you attach the PDF above; or paste the text here…",
    opts_cvtext_help: "Attaching a PDF above extracts it here automatically. The AI drafts cover letters and answers from this text, and fills «Resume» fields with it. You can edit it.",
    opts_save: "Save",
    // --- options.js (dynamic) ---
    api_key_label: "API key for {name}",
    api_key_optional: "API key (leave empty if the server doesn't require it)",
    custom_provider_hint: "Any OpenAI-compatible API: OpenRouter, Groq, Together, Mistral, DeepSeek, Ollama/LM Studio (local)…",
    provider_custom: "OpenAI-compatible (custom)",
    model_custom_option: "Custom…",
    err_need_model: "✗ Enter the model id",
    err_need_baseurl: "✗ Missing the provider's Base URL",
    saved_ok: "✓ Saved",
    saved_bad_json: "✗ The profile is not valid JSON",
    net_denied: "✗ Network permission denied for that URL",
    test_probing: "⏳ Testing…",
    test_ok: "✓ OK ({ms} ms) — {tag}",
    test_fail: "✗ {error}",
    test_no_response: "no response",
    cvfile_saved: "Saved: {name}",
    cvfile_saved_ok: "✓ Saved: {name} ({kb} KB)",
    cv_extracting: "⏳ Extracting text from the PDF…",
    cv_no_selectable: "the PDF has no selectable text (is it a scan/image?)",
    cv_extracted: "✓ Text extracted ({len} characters) and saved.",
    cv_extract_fail: "✗ Couldn't extract the text: {error}. Paste it by hand below.",
    cv_only_pdf: "ℹ I only extract text from PDF; for other formats paste the text by hand.",
    // --- provider key labels (brand names neutral) ---
    // --- model description tags ---
    m_fast: "fast",
    m_powerful: "powerful",
    m_balanced: "balanced",
    m_cheap_fast: "cheap, fast",
    m_open_moe: "open, fast MoE",
    m_open_largest: "open, the largest",
    m_reasoning: "reasoning",
    m_strongest: "the strongest",
    // --- providers.js (errors, shown in UI) ---
    prov_unknown: "Unknown provider: {provider}",
    prov_missing_key: "Missing the API key for {label} (set it in Settings).",
    prov_missing_model: "Missing the model for {label} (enter it in Settings).",
    prov_missing_baseurl: "Missing the Base URL for the custom provider (set it in Settings).",
    prov_empty: "empty response (finish={reason})",
    prov_blocked: "prompt blocked ({reason})",
    prov_max_tokens: "response ran out of tokens while thinking (raise «max output tokens»)",
    prov_no_candidates: "no candidates",
    // custom provider key hint
    key_hint_custom: "sk-… · empty for local servers",
    // network / json errors (shown in the log)
    bg_timeout: "{tag}: no data for {secs}s (the model went silent)",
    bg_network: "{tag}: network — {error}",
    bg_no_json: "{tag}: did not return JSON. It started with: {start}",
    bg_bad_json: "{tag}: invalid JSON ({error}). Text: {text}",
    // --- background.js (logs, badges, summaries) ---
    bg_obligatory: ", required",
    bg_run_new: "── new run: {title}",
    bg_scanning: "Scanning form…",
    bg_scan_result: "Scan: {n} fields detected (frame {frame}).",
    bg_scan_zero: "No fields found. Press «Apply» to open the form and retry.",
    bg_generating: "Generating AI answers for {n} fields…",
    bg_ai_done: "AI ({tag}): {n} answers in {secs}s.",
    bg_filling: "Filling…",
    bg_retry: "⚠ {tag}: {status}; retry {n}/{total} in {secs}s…",
    bg_quota: "quota exhausted (429)",
    bg_server_fail: "server failure ({status})",
    bg_stalled: "the model went silent (timeout)",
    bg_trying_fallback: "⚠ {tag}: {reason}. Trying fallback…",
    bg_fallback_ok: "↪ Fallback OK with {tag}",
    bg_fallback_fail: "⚠ Fallback {tag} failed: {error}",
    bg_filled: "✓ Filled {ok} fields",
    bg_filled_fail: ", {fail} in red (check them).",
    bg_filled_done: ".",
    bg_resume_note: "\n📄 Text «Resume» filled with your CV.",
    bg_files_note: "\n⬇ {n} file field(s) (in orange): attach {cv} by hand.",
    bg_done: "Done: {ok} ok, {fail} failed, {files} file.",
    // --- content.js (per-field reasons, shown in the log) ---
    c_upload_manual: "upload it yourself (the browser blocks it for security)",
    c_index_oob: "index outside the scanned form",
    c_no_value: "the AI returned no value",
    c_not_numeric: "non-numeric value for a number field",
    c_option_not_found: "option not found",
    c_radio_not_found: "radio option not found",
    c_reactselect_failed: "react-select not resolved",
    c_field_not_found: "(field not found)",
    c_attach_manual: "attach it by hand (the browser blocks it for security)",
  },
  es: {
    // --- popup.html ---
    app_title: "job-autofill",
    btn_fill: "⚡ Rellenar con IA",
    btn_cvdl: "⬇ CV a Descargas",
    btn_cvcopy: "📋 Copiar CV",
    btn_scan: "Solo escanear",
    btn_opts: "Ajustes",
    btn_showlog: "Ver registro",
    btn_hidelog: "Ocultar registro",
    btn_copylog: "📋 Copiar registro",
    popup_footer: "Revisa, adjunta el CV y <b>envía tú</b>. La extensión nunca envía.",
    // --- popup.js (dynamic) ---
    run_running: "⏳ En curso desde {time}…",
    run_error: "✗ Error ({time}): {error}",
    run_done: "✓ Terminado {time} — {ok} ok",
    run_done_fail: ", {fail} fallo(s)",
    run_done_files: ", {files} fichero",
    scan_zero: "0 campos. Pulsa «Apply» para abrir el formulario y reintenta.",
    scan_result: "Detectados {total} campos ({fillable} rellenables, {files} de fichero/manual).",
    scan_unreadable: "No pude leer la página. ¿Es una pestaña web normal?",
    working: "Trabajando… puedes cerrar esta ventana; sigue en segundo plano.",
    error_prefix: "Error: ",
    cv_no_pdf: "No hay PDF guardado. Cárgalo en «Ajustes».",
    cv_downloaded: "⬇ {name} guardado en Descargas; ya puedes adjuntarlo.",
    cv_no_text: "No hay texto de CV. Pégalo en «Ajustes».",
    cv_copied: "📋 Texto del CV copiado al portapapeles.",
    cv_copy_fail: "No pude copiar (permiso de portapapeles).",
    log_empty: "No hay registro todavía.",
    log_copied: "📋 Registro copiado al portapapeles.",
    log_copy_fail: "No pude copiar el registro (permiso de portapapeles).",
    config_missing: "⚙ Configura proveedor, API key y perfil en «Ajustes» primero.",
    cv_default: "tu CV",
    // --- options.html ---
    opts_title: "job-autofill · Ajustes",
    opts_keywarn: "🔑 La API key se guarda solo en <b>este navegador</b> (chrome.storage.local) y se usa desde el background para llamar al proveedor que elijas. <b>No la compartas</b>. Si la expusiste en algún sitio, regénerala en el panel del proveedor.",
    opts_lang_label: "Idioma de la interfaz",
    opts_provider_label: "Proveedor de IA",
    opts_apikey_label: "API key",
    opts_baseurl_label: "Base URL del API",
    opts_model_label: "Modelo",
    opts_model_custom_ph: "id del modelo (p.ej. llama-3.3-70b)",
    opts_model_help: "Cada proveedor trae modelos sugeridos; «Personalizado…» acepta cualquier id válido de ese proveedor. Si agotas la cuota de un modelo, cambia a otro o de proveedor.",
    opts_test_btn: "Probar conexión",
    opts_fallback_label: "Usar otros proveedores (con key) como respaldo si se agota la cuota (429)",
    opts_advanced: "Opciones avanzadas",
    opts_temp_label: "Temperatura (0–2)",
    opts_temp_help: "Más baja = respuestas más deterministas. Por defecto 0.4.",
    opts_maxtok_label: "Máx. tokens de salida",
    opts_maxtok_help: "Súbelo si las respuestas se cortan. Por defecto 8192.",
    opts_timeout_label: "Timeout por petición (s)",
    opts_timeout_help: "Súbelo si el modelo es lento (p.ej. Gemma) y la petición se agota. Por defecto 180.",
    opts_jsonmode_label: "Forzar modo JSON (<code>response_format</code>)",
    opts_jsonmode_help: "Mejora la fiabilidad del JSON, pero algunos servidores compatibles lo rechazan: desactívalo si da error 400.",
    opts_profile_label: "Perfil (JSON)",
    opts_profile_help: "Nombre, email, LinkedIn, salario, etc. Lo usa la IA para rellenar los campos.",
    opts_cvfile_label: "CV en PDF (para descargar/adjuntar rápido)",
    opts_cvfile_help: "El navegador no deja adjuntarlo por script, pero el popup te lo baja a Descargas con un clic para que solo tengas que seleccionarlo.",
    opts_cvtext_label: "CV (texto plano)",
    opts_cvtext_ph: "Se rellena solo al adjuntar el PDF arriba; o pega aquí el texto…",
    opts_cvtext_help: "Al adjuntar un PDF arriba se extrae aquí automáticamente. La IA redacta cover letters y respuestas a partir de este texto, y rellena con él los campos de «Resume». Puedes editarlo.",
    opts_save: "Guardar",
    // --- options.js (dynamic) ---
    api_key_label: "API key de {name}",
    api_key_optional: "API key (déjala vacía si el servidor no la pide)",
    custom_provider_hint: "Cualquier API compatible con OpenAI: OpenRouter, Groq, Together, Mistral, DeepSeek, Ollama/LM Studio (local)…",
    provider_custom: "Compatible con OpenAI (personalizado)",
    model_custom_option: "Personalizado…",
    err_need_model: "✗ Escribe el id del modelo",
    err_need_baseurl: "✗ Falta la Base URL del proveedor",
    saved_ok: "✓ Guardado",
    saved_bad_json: "✗ El perfil no es JSON válido",
    net_denied: "✗ Permiso de red denegado para esa URL",
    test_probing: "⏳ Probando…",
    test_ok: "✓ OK ({ms} ms) — {tag}",
    test_fail: "✗ {error}",
    test_no_response: "sin respuesta",
    cvfile_saved: "Guardado: {name}",
    cvfile_saved_ok: "✓ Guardado: {name} ({kb} KB)",
    cv_extracting: "⏳ Extrayendo texto del PDF…",
    cv_no_selectable: "el PDF no contiene texto seleccionable (¿es un escaneo/imagen?)",
    cv_extracted: "✓ Texto extraído ({len} caracteres) y guardado.",
    cv_extract_fail: "✗ No pude extraer el texto: {error}. Pégalo a mano abajo.",
    cv_only_pdf: "ℹ Solo extraigo texto de PDF; para otros formatos pega el texto a mano.",
    // --- model description tags ---
    m_fast: "rápido",
    m_powerful: "potente",
    m_balanced: "equilibrado",
    m_cheap_fast: "barato, rápido",
    m_open_moe: "abierto, MoE rápido",
    m_open_largest: "abierto, el más grande",
    m_reasoning: "razonamiento",
    m_strongest: "el más potente",
    // --- providers.js (errores, se muestran en la UI) ---
    prov_unknown: "Proveedor desconocido: {provider}",
    prov_missing_key: "Falta la API key de {label} (ponla en Ajustes).",
    prov_missing_model: "Falta el modelo de {label} (escríbelo en Ajustes).",
    prov_missing_baseurl: "Falta la Base URL del proveedor personalizado (ponla en Ajustes).",
    prov_empty: "respuesta vacía (finish={reason})",
    prov_blocked: "prompt bloqueado ({reason})",
    prov_max_tokens: "respuesta agotó tokens pensando (sube «máx. tokens de salida»)",
    prov_no_candidates: "sin candidatos",
    key_hint_custom: "sk-… · vacío para servidores locales",
    // errores de red / json (se muestran en el registro)
    bg_timeout: "{tag}: sin datos en {secs}s (el modelo se quedó mudo)",
    bg_network: "{tag}: red — {error}",
    bg_no_json: "{tag}: no devolvió JSON. Empezaba con: {start}",
    bg_bad_json: "{tag}: JSON inválido ({error}). Texto: {text}",
    // --- background.js (registro, badges, resúmenes) ---
    bg_obligatory: ", obligatorio",
    bg_run_new: "── nueva ejecución: {title}",
    bg_scanning: "Escaneando formulario…",
    bg_scan_result: "Escaneo: {n} campos detectados (frame {frame}).",
    bg_scan_zero: "No encontré campos. Pulsa «Apply» para abrir el formulario y reintenta.",
    bg_generating: "Generando respuestas con IA para {n} campos…",
    bg_ai_done: "IA ({tag}): {n} respuestas en {secs}s.",
    bg_filling: "Rellenando…",
    bg_retry: "⚠ {tag}: {status}; reintento {n}/{total} en {secs}s…",
    bg_quota: "cuota agotada (429)",
    bg_server_fail: "fallo del servidor ({status})",
    bg_stalled: "el modelo se quedó mudo (timeout)",
    bg_trying_fallback: "⚠ {tag}: {reason}. Probando respaldo…",
    bg_fallback_ok: "↪ Respaldo OK con {tag}",
    bg_fallback_fail: "⚠ Respaldo {tag} falló: {error}",
    bg_filled: "✓ Rellenados {ok} campos",
    bg_filled_fail: ", {fail} en rojo (revísalos).",
    bg_filled_done: ".",
    bg_resume_note: "\n📄 «Resume» en texto rellenado con tu CV.",
    bg_files_note: "\n⬇ {n} campo(s) de fichero (en naranja): adjunta {cv} a mano.",
    bg_done: "Hecho: {ok} ok, {fail} fallidos, {files} de fichero.",
    // --- content.js (motivos por campo, se muestran en el registro) ---
    c_upload_manual: "súbelo tú (el navegador no deja por seguridad)",
    c_index_oob: "índice fuera del formulario escaneado",
    c_no_value: "la IA no devolvió valor",
    c_not_numeric: "valor no numérico para campo number",
    c_option_not_found: "opción no encontrada",
    c_radio_not_found: "opción radio no encontrada",
    c_reactselect_failed: "react-select no resuelto",
    c_field_not_found: "(campo no encontrado)",
    c_attach_manual: "adjúntalo a mano (el navegador no deja por seguridad)",
  },
};
