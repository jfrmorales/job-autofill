// background.js (service worker) — llama a un modelo de Google (Gemini o Gemma).
// Se ejecuta aquí (no en la página) para evitar CORS y no exponer la key al sitio.
// El modelo es configurable en Options (chrome.storage.local "model").

const DEFAULT_MODEL = "gemini-3.5-flash";

function buildPrompt(profile, cvText, pageText, fields) {
  const fieldList = fields
    .filter((f) => f.type !== "file")
    .map((f) => {
      let line = `[${f.index}] (${f.type}${f.required ? ", obligatorio" : ""}) ${f.label}`;
      if (f.options && f.options.length) line += ` | opciones: ${f.options.join(" / ")}`;
      return line;
    })
    .join("\n");

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
${JSON.stringify(profile, null, 2)}

# CV (texto)
${(cvText || "").slice(0, 6000)}

# Oferta / página
${pageText.slice(0, 4000)}

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

async function generate({ profile, cvText, pageText, fields }) {
  const { apiKey, model } = await chrome.storage.local.get(["apiKey", "model"]);
  if (!apiKey) throw new Error("Falta la API key (ponla en Options).");

  const MODEL = (model || DEFAULT_MODEL).trim();
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const isGemma = MODEL.startsWith("gemma");
  const generationConfig = { temperature: 0.4, maxOutputTokens: 8192 };
  // Gemma no soporta responseMimeType (JSON mode); el prompt ya pide JSON explícito
  // y abajo extraemos el objeto del texto.
  if (!isGemma) generationConfig.responseMimeType = "application/json";

  const body = {
    contents: [{ parts: [{ text: buildPrompt(profile, cvText, pageText, fields) }] }],
    generationConfig,
  };

  // Timeout: si la API tarda o se cuelga, fallamos con mensaje en vez de quedarnos colgados.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90000);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `${MODEL}: sin respuesta en 90s (timeout)` : `${MODEL}: red — ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${MODEL} ${res.status}: ${t.slice(0, 300)}`);
  }

  const data = await res.json();
  if (data.promptFeedback?.blockReason) {
    throw new Error(`${MODEL}: prompt bloqueado (${data.promptFeedback.blockReason})`);
  }
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const txt = parts.filter((p) => p && typeof p.text === "string").map((p) => p.text).join("");
  if (!txt) {
    const reason = cand?.finishReason || "sin candidatos";
    throw new Error(reason === "MAX_TOKENS"
      ? `${MODEL}: respuesta agotó tokens pensando (sube maxOutputTokens o usa thinkingLevel más bajo)`
      : `${MODEL}: respuesta vacía (finishReason=${reason})`);
  }

  // Limpia vallas markdown (```json … ```) y recorta al objeto JSON.
  const clean = txt.replace(/```(?:json)?/gi, "");
  const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(`${MODEL}: no devolvió JSON. Empezaba con: ${txt.slice(0, 120)}`);
  try {
    return JSON.parse(clean.slice(a, b + 1));
  } catch (e) {
    throw new Error(`${MODEL}: JSON inválido (${e.message}). Texto: ${clean.slice(a, a + 150)}`);
  }
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
  badge("…", "#2b6cb0");
  try {
    progress("Escaneando formulario…");
    const { fields, contextText, frameId } = await doScan(tabId, tabUrl);
    if (!fields.length) {
      badge("0", "#dd6b20");
      return { ok: false, error: "No encontré campos. Pulsa «Apply» para abrir el formulario y reintenta." };
    }

    const { cvText, cvFileName, profile } = await chrome.storage.local.get(["cvText", "cvFileName", "profile"]);

    // campos de "Resume" en texto -> se rellenan con tu CV (sin IA)
    const resumeFields = fields.filter((f) => f.resume);
    const aiFields = fields.filter((f) => !f.resume);

    progress(`Generando respuestas con IA para ${aiFields.length} campos…`);
    const answers = { ...(await generate({
      profile: profile || {}, cvText: cvText || "", pageText: contextText, fields: aiFields,
    })) };
    if (cvText) for (const f of resumeFields) answers[f.index] = cvText;

    progress("Rellenando…");
    const r = await chrome.tabs.sendMessage(tabId, { action: "fill", answers }, { frameId });

    badge(String(r.ok), r.fail ? "#dd6b20" : "#38a169");
    let msg = `✓ Rellenados ${r.ok} campos` + (r.fail ? `, ${r.fail} en rojo (revísalos).` : ".");
    if (resumeFields.length && cvText) msg += "\n📄 «Resume» en texto rellenado con tu CV.";
    if (r.files) msg += `\n⬇ ${r.files} campo(s) de fichero (en naranja): adjunta ${cvFileName || "tu CV"} a mano.`;
    return { ok: true, summary: msg };
  } catch (e) {
    badge("!", "#e53e3e");
    return { ok: false, error: String(e.message || e) };
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
