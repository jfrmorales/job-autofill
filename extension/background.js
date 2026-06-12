// background.js (service worker) — llama al modelo de IA configurado.
// Se ejecuta aquí (no en la página) para evitar CORS y no exponer la key al sitio.
// El proveedor (Google / OpenAI / Anthropic / compatible) y el modelo se
// configuran en Ajustes; providers.js sabe cómo hablar con cada API.
importScripts("i18n.js", "providers.js");

function buildPrompt(profile, cvText, pageText, fields) {
  const fieldList = fields
    .filter((f) => f.type !== "file")
    .map((f) => {
      const req = f.required ? t("bg_obligatory") : "";
      const optsLabel = getLang() === "es" ? "opciones" : "options";
      let line = `[${f.index}] (${f.type}${req}) ${f.label}`;
      if (f.options && f.options.length) line += ` | ${optsLabel}: ${f.options.join(" / ")}`;
      return line;
    })
    .join("\n");

  const profileJson = JSON.stringify(profile, null, 2);
  const cv = (cvText || "").slice(0, 6000);
  const page = pageText.slice(0, 4000);

  if (getLang() === "es") {
    return `Eres un asistente que rellena formularios de candidatura de empleo.
Responde en el MISMO idioma de la oferta. No inventes EXPERIENCIA que no esté en el CV.

# Reglas de respuesta (importante)
- PROHIBIDO evadir. No uses frases como "lo discutiré en la entrevista", "estoy
  abierto a negociar", "podemos hablarlo más adelante". Comprométete con datos concretos.
- Salario: si el perfil trae "salary_expectation" con valor, úsalo tal cual. Si está
  vacío, ESTIMA un rango bruto anual de mercado REALISTA para este puesto concreto, la
  seniority del candidato (mira el CV) y la modalidad/ubicación (remoto, España/EU).
  En un campo de texto da un rango con moneda, p.ej. "55.000–65.000 € brutos/año".
  En un campo (number) devuelve SOLO el número entero del extremo inferior, sin moneda
  ni separadores ni rango, p.ej. 55000.
- Preaviso / disponibilidad / fecha de incorporación: usa "notice_period" del perfil
  (p.ej. "15 días"). No digas que lo hablarás luego.
- Si una pregunta junta varios temas (p.ej. salario + preaviso), responde TODOS con concreción.

# Perfil del candidato
${profileJson}

# CV (texto)
${cv}

# Oferta / página
${page}

# Campos del formulario
${fieldList}

# Instrucciones de salida
Responde con UN solo objeto JSON y NADA más (sin markdown, sin \`\`\`, sin texto antes ni después).
Las CLAVES del objeto son los NÚMEROS que aparecen entre corchetes al inicio de cada campo de
la lista de arriba (0, 1, 2, …). Los VALORES son tu respuesta para ese campo.
NO uses las palabras literales "index"/"indice" ni "value"/"valor": son solo un ejemplo de forma.
Ejemplo de FORMATO (con datos inventados; usa los números y datos REALES de este caso):
{"0": "Jose Morales", "2": "jose@example.com", "5": "55000"}

Reglas por tipo de campo:
- text/textarea: el texto adecuado. Para preguntas abiertas (cover letter, "why this company", motivación) redacta una respuesta concreta y honesta basada en el CV.
- select: devuelve EXACTAMENTE una de las strings de "opciones".
- number: devuelve SOLO dígitos, sin moneda, separadores de miles, símbolos ni rangos (p.ej. 65000).
- email/tel/url/date: devuelve un valor con el formato propio de ese tipo.
- boolean: "true" o "false".
- Omite una clave solo si de verdad no tienes el dato (p.ej. teléfono no presente en el
  perfil) ni puedes estimarlo razonablemente. El salario y el preaviso SIEMPRE se responden.`;
  }

  return `You are an assistant that fills in job application forms.
Answer in the SAME language as the job posting. Do NOT invent EXPERIENCE that is not in the CV.

# Answer rules (important)
- NO evasions. Don't use phrases like "I'll discuss it in the interview", "I'm
  open to negotiate", "we can talk about it later". Commit to concrete data.
- Salary: if the profile has "salary_expectation" with a value, use it as is. If it's
  empty, ESTIMATE a REALISTIC gross annual market range for this specific role, the
  candidate's seniority (see the CV) and the modality/location (remote, Spain/EU).
  In a text field give a range with currency, e.g. "55,000–65,000 € gross/year".
  In a (number) field return ONLY the integer of the lower bound, without currency,
  separators or range, e.g. 55000.
- Notice period / availability / start date: use the profile's "notice_period"
  (e.g. "15 days"). Don't say you'll talk about it later.
- If a question bundles several topics (e.g. salary + notice), answer ALL of them concretely.

# Candidate profile
${profileJson}

# CV (text)
${cv}

# Job / page
${page}

# Form fields
${fieldList}

# Output instructions
Respond with ONE single JSON object and NOTHING else (no markdown, no \`\`\`, no text before or after).
The object's KEYS are the NUMBERS shown in brackets at the start of each field in the
list above (0, 1, 2, …). The VALUES are your answer for that field.
Do NOT use the literal words "index" or "value": they are just an example of the shape.
FORMAT example (with made-up data; use the REAL numbers and data of this case):
{"0": "Jose Morales", "2": "jose@example.com", "5": "55000"}

Rules per field type:
- text/textarea: the appropriate text. For open questions (cover letter, "why this company", motivation) write a concrete, honest answer based on the CV.
- select: return EXACTLY one of the strings in "options".
- number: return ONLY digits, no currency, thousands separators, symbols or ranges (e.g. 65000).
- email/tel/url/date: return a value with the proper format for that type.
- boolean: "true" or "false".
- Omit a key only if you truly don't have the data (e.g. phone not present in the
  profile) and can't reasonably estimate it. Salary and notice period are ALWAYS answered.`;
}

// Hace UNA llamada al proveedor de `cfg` con el `prompt` ya construido y
// devuelve el texto crudo de la respuesta. Lanza Error con `.status` (código
// HTTP) y `.tag` (proveedor·modelo) para que quien llame decida si reintenta.
async function callProvider(cfg, prompt, timeoutMs = 90000) {
  const { P } = cfg;
  const tag = `${P.label} · ${cfg.model}`;
  const endpoint = P.endpoint(cfg.baseUrl, cfg.model);
  const headers = P.headers(cfg.apiKey);
  const body = P.body(cfg.model, prompt, {
    temperature: cfg.temperature, maxTokens: cfg.maxTokens, jsonMode: cfg.jsonMode,
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    const err = new Error(e.name === "AbortError"
      ? t("bg_timeout", { tag, secs: Math.round(timeoutMs / 1000) })
      : t("bg_network", { tag, error: e.message }));
    err.tag = tag;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`${tag} ${res.status}: ${t.slice(0, 300)}`);
    err.status = res.status;
    err.tag = tag;
    throw err;
  }
  const data = await res.json();
  try {
    return P.extract(data); // cada proveedor sabe dónde está el texto y qué error dar
  } catch (e) {
    const err = new Error(`${tag}: ${e.message}`);
    err.tag = tag;
    throw err;
  }
}

// Limpia vallas markdown (```json … ```) y recorta al objeto JSON.
function parseJsonObject(txt, tag) {
  const clean = txt.replace(/```(?:json)?/gi, "");
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(t("bg_no_json", { tag, start: txt.slice(0, 120) }));
  try {
    return JSON.parse(clean.slice(a, b + 1));
  } catch (e) {
    throw new Error(t("bg_bad_json", { tag, error: e.message, text: clean.slice(a, a + 150) }));
  }
}

// Errores transitorios del servidor del proveedor (sobrecarga/glitch puntual):
// merece la pena reintentar la MISMA llamada. Los 500 INTERNAL de Gemma en el
// endpoint de Google son el caso típico.
const RETRY_STATUS = new Set([500, 502, 503, 504]);
// Cuándo cambiar a otro proveedor: cuota agotada (429) o fallo de servidor (5xx).
function isFailover(e) {
  return e && (e.status === 429 || (e.status >= 500 && e.status < 600));
}

// Llama al proveedor reintentando los errores transitorios (5xx) de ESE mismo
// proveedor con backoff. No reintenta 429 (eso lo resuelve el respaldo) ni los
// errores definitivos (4xx de auth/modelo).
async function callWithRetry(cfg, prompt, notify, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await callProvider(cfg, prompt);
    } catch (e) {
      lastErr = e;
      if (!RETRY_STATUS.has(e.status) || i === tries - 1) throw e;
      const wait = 1000 * (i + 1); // 1s, 2s…
      if (notify) notify(t("bg_retry", { tag: e.tag, status: e.status, n: i + 1, total: tries - 1, secs: wait / 1000 }));
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Proveedores DISTINTOS al primario que tienen key (o no la necesitan) y, si son
// "custom", base URL: candidatos de respaldo cuando el primario falla (cuota/5xx).
function fallbackConfigs(store, excludeProvider) {
  const apiKeys = store.apiKeys || (store.apiKey ? { google: store.apiKey } : {});
  const out = [];
  for (const id of Object.keys(PROVIDERS)) {
    if (id === excludeProvider) continue;
    const P = PROVIDERS[id];
    const hasKey = (apiKeys[id] || "").trim() || P.allowEmptyKey;
    if (!hasKey) continue;
    if (!P.fixedBaseUrl && !(store.customBaseUrl || "").trim()) continue;
    try {
      // cada respaldo usa su modelo por defecto y su modo JSON propio (jsonMode undefined)
      out.push(resolveProviderConfig({ ...store, provider: id, model: P.defaultModel, jsonMode: undefined }));
    } catch { /* config incompleta: lo saltamos */ }
  }
  return out;
}

// Genera respuestas con el proveedor configurado. Si agota cuota (HTTP 429) y el
// usuario activó el respaldo, prueba con los demás proveedores que tengan key.
async function generate({ profile, cvText, pageText, fields, notify }) {
  const store = await chrome.storage.local.get(
    ["provider", "model", "apiKeys", "apiKey", "customBaseUrl", "jsonMode", "temperature", "maxTokens", "fallback"]
  );
  const prompt = buildPrompt(profile, cvText, pageText, fields);
  const primary = resolveProviderConfig(store); // valida y aplica compatibilidad hacia atrás

  try {
    return parseJsonObject(await callWithRetry(primary, prompt, notify), `${primary.P.label} · ${primary.model}`);
  } catch (e) {
    if (!isFailover(e) || !store.fallback) throw e;
    const reason = e.status === 429 ? t("bg_quota") : t("bg_server_fail", { status: e.status });
    if (notify) notify(t("bg_trying_fallback", { tag: e.tag || primary.P.label, reason }));
    let lastErr = e;
    for (const cfg of fallbackConfigs(store, primary.provider)) {
      const tag = `${cfg.P.label} · ${cfg.model}`;
      try {
        const out = parseJsonObject(await callWithRetry(cfg, prompt, notify), tag);
        if (notify) notify(t("bg_fallback_ok", { tag }));
        return out;
      } catch (e2) {
        lastErr = e2;
        if (notify) notify(t("bg_fallback_fail", { tag, error: e2.message }));
      }
    }
    throw lastErr;
  }
}

// Comprobación de conexión (botón "Probar conexión" de Ajustes). Recibe la
// config tal cual está en el formulario (sin necesidad de guardarla) y hace una
// petición mínima. Devuelve { ok, ms, tag, sample } o lanza con el motivo.
async function testConnection(store) {
  await applyLangFromStore();
  const cfg = resolveProviderConfig(store); // lanza si falta key/modelo/base URL
  const tag = `${cfg.P.label} · ${cfg.model}`;
  const t0 = Date.now();
  // prompt trivial; sin forzar JSON y con tokens holgados (los de razonamiento
  // gastan tokens "pensando" antes de emitir texto).
  const ping = getLang() === "es" ? "Responde solo con la palabra: ok" : "Reply with only the word: ok";
  const txt = await callProvider({ ...cfg, jsonMode: false, maxTokens: 256 }, ping, 30000);
  return { ok: true, ms: Date.now() - t0, tag, sample: (txt || "").trim().slice(0, 40) };
}

// ---------------------------------------------------------- orquestación
// Todo el pipeline (escanear → generar → rellenar) vive AQUÍ, en el service
// worker, no en el popup. Motivo: en MV3 el popup se destruye al perder el
// foco; si la generación viviera allí, cerrar/cambiar de pestaña abortaría el
// relleno. El SW persiste mientras haya un fetch en curso, así que el trabajo
// termina aunque el popup esté cerrado. El popup solo dispara y observa.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Feedback visible aunque el popup esté cerrado: badge del icono.
function badge(text, color) {
  chrome.action.setBadgeText({ text: text || "" });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// Avisa al popup del progreso si sigue abierto; si no, falla en silencio.
function progress(text) {
  chrome.runtime.sendMessage({ type: "progress", text }).catch(() => {});
}

// ----------------------------------------------------------- registro
// El popup se destruye al perder el foco, así que el feedback en pantalla se
// pierde. Persistimos TODO en chrome.storage.local: `lastRun` (estado actual de
// la última ejecución) y `runLog` (anillo de líneas con timestamp). El popup los
// lee al abrir y se suscribe a storage.onChanged para refrescarse en vivo.
const LOG_CAP = 200;

async function pushLog(level, text) {
  try {
    const { runLog = [] } = await chrome.storage.local.get("runLog");
    runLog.push({ ts: Date.now(), level, text });
    if (runLog.length > LOG_CAP) runLog.splice(0, runLog.length - LOG_CAP);
    await chrome.storage.local.set({ runLog });
  } catch {}
}

async function patchRun(patch) {
  const { lastRun = {} } = await chrome.storage.local.get("lastRun");
  await chrome.storage.local.set({ lastRun: { ...lastRun, ...patch } });
}

// Progreso visible (popup) + persistido (registro), de una vez.
async function step(text) {
  progress(text);
  await pushLog("info", text);
}

// Un pase de escaneo sobre todos los frames de la pestaña (movido desde popup).
async function scanFrames(tabId) {
  let frames = [{ frameId: 0 }];
  try { frames = await chrome.webNavigation.getAllFrames({ tabId }); } catch {}
  const withFields = [];
  let topText = "";
  for (const fr of frames) {
    let res;
    try { res = await chrome.tabs.sendMessage(tabId, { action: "scan" }, { frameId: fr.frameId }); }
    catch { continue; } // frame sin nuestro script (sandbox, about:blank…)
    if (!res) continue;
    if (fr.frameId === 0) topText = res.pageText || "";
    if (res.fields?.length) withFields.push({ frameId: fr.frameId, ...res });
  }
  withFields.sort((a, b) => b.fields.length - a.fields.length);
  return { withFields, topText };
}

async function doScan(tabId, tabUrl) {
  let { withFields, topText } = await scanFrames(tabId);
  if (!withFields.length) {
    await sleep(1600); // el 1er pase pudo disparar "Apply"; deja cargar el iframe
    ({ withFields, topText } = await scanFrames(tabId));
  }
  const best = withFields[0] || { frameId: 0, fields: [], pageText: topText, url: tabUrl };
  best.contextText = (topText + "\n" + (best.pageText || "")).slice(0, 6000);
  return best;
}

// Pipeline completo. Devuelve un resumen para el popup (si sigue abierto) y deja
// el resultado en el badge para cuando esté cerrado.
async function runFill(tabId, tabUrl) {
  await applyLangFromStore();
  const startedAt = Date.now();
  let title = tabUrl;
  try { const tb = await chrome.tabs.get(tabId); if (tb?.title) title = tb.title; } catch {}
  // arranca un registro limpio de ejecución (estado "running" desde ya)
  await chrome.storage.local.set({ lastRun: { state: "running", startedAt, url: tabUrl, title } });
  await pushLog("info", t("bg_run_new", { title }));
  badge("…", "#2b6cb0");
  try {
    await step(t("bg_scanning"));
    const { fields, contextText, frameId } = await doScan(tabId, tabUrl);
    await patchRun({ scan: { fields: fields.length, frameId } });
    await pushLog("info", t("bg_scan_result", { n: fields.length, frame: frameId }));
    if (!fields.length) {
      badge("0", "#dd6b20");
      const error = t("bg_scan_zero");
      await patchRun({ state: "error", finishedAt: Date.now(), error });
      await pushLog("error", error);
      return { ok: false, error };
    }

    const { cvText, cvFileName, profile, model, provider } = await chrome.storage.local.get(["cvText", "cvFileName", "profile", "model", "provider"]);
    const modelTag = `${PROVIDERS[provider || DEFAULT_PROVIDER]?.label || provider || "?"} · ${model || "?"}`;

    // campos de "Resume" en texto -> se rellenan con tu CV (sin IA)
    const resumeFields = fields.filter((f) => f.resume);
    const aiFields = fields.filter((f) => !f.resume);

    await step(t("bg_generating", { n: aiFields.length }));
    const genStart = Date.now();
    const answers = { ...(await generate({
      profile: profile || {}, cvText: cvText || "", pageText: contextText, fields: aiFields,
      notify: (msg) => step(msg), // mensajes de respaldo (429) al registro/progreso
    })) };
    await pushLog("info", t("bg_ai_done", { tag: modelTag, n: Object.keys(answers).length, secs: Math.round((Date.now() - genStart) / 1000) }));
    if (cvText) for (const f of resumeFields) answers[f.index] = cvText;

    await step(t("bg_filling"));
    const r = await chrome.tabs.sendMessage(tabId, { action: "fill", answers }, { frameId });

    // registra el resultado de cada campo, con el motivo del fallo si lo hubo
    for (const d of (r.details || [])) {
      const lvl = d.status === "ok" ? "ok" : d.status === "fail" ? "warn" : "info";
      const icon = d.status === "ok" ? "✓" : d.status === "fail" ? "✗" : d.status === "file" ? "⬇" : "·";
      const tail = d.reason ? ` — ${d.reason}` : (d.value ? ` = ${d.value}` : "");
      await pushLog(lvl, `${icon} ${d.label}${tail}`);
    }

    badge(String(r.ok), r.fail ? "#dd6b20" : "#38a169");
    let msg = t("bg_filled", { ok: r.ok }) + (r.fail ? t("bg_filled_fail", { fail: r.fail }) : t("bg_filled_done"));
    if (resumeFields.length && cvText) msg += t("bg_resume_note");
    if (r.files) msg += t("bg_files_note", { n: r.files, cv: cvFileName || t("cv_default") });
    await patchRun({
      state: "done", finishedAt: Date.now(), summary: msg,
      result: { ok: r.ok, fail: r.fail, files: r.files, details: r.details || [] },
    });
    await pushLog("info", t("bg_done", { ok: r.ok, fail: r.fail, files: r.files }));
    return { ok: true, summary: msg };
  } catch (e) {
    badge("!", "#e53e3e");
    const error = String(e.message || e);
    await patchRun({ state: "error", finishedAt: Date.now(), error });
    await pushLog("error", error);
    return { ok: false, error };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Pipeline completo en el SW: sobrevive al cierre del popup.
  if (msg.action === "run") {
    runFill(msg.tabId, msg.tabUrl)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // async
  }
  // Probar conexión con el proveedor (desde Ajustes), sin guardar nada.
  if (msg.action === "testConnection") {
    testConnection(msg.store)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // async
  }
  // Solo escanear: cuenta campos sin generar ni rellenar.
  if (msg.action === "scanOnly") {
    doScan(msg.tabId, msg.tabUrl)
      .then((best) => sendResponse({ ok: true, fields: best.fields }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true; // async
  }
  // Compat: generación suelta (por si algo la usa todavía).
  if (msg.action === "generate") {
    chrome.storage.local.get(["profile", "cvText"]).then(({ profile, cvText }) => {
      generate({ profile: profile || {}, cvText: cvText || "", pageText: msg.pageText, fields: msg.fields })
        .then((answers) => sendResponse({ ok: true, answers }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    });
    return true; // async
  }
});
