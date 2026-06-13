const $ = (id) => document.getElementById(id);

const DEFAULT_PROFILE = {
  first_name: "Jose",
  last_name: "Morales",
  email: "jfrmorales@outlook.com",
  phone: "",
  location: "Santander, Spain (Remote)",
  linkedin: "https://www.linkedin.com/in/jfrmorales",
  github: "https://github.com/jfrmorales",
  website: "https://jfrmorales.github.io",
  salary_expectation: "",
  notice_period: "15 días",
  work_authorization_eu: "Yes",
  requires_visa_sponsorship: "No",
  pitch: "DevOps, SRE & AI Automation Engineer con 9+ años en IT.",
};

// Estado en memoria. Guardamos las claves/modelos POR proveedor para que cambiar
// de proveedor en el desplegable no borre lo que ya tenías escrito en otro.
const state = {
  keys: {},        // { google: "...", openai: "...", ... }
  models: {},      // { google: "gemini-3.5-flash", ... }
  jsonMode: {},    // { openai: true, custom: false }
  customBaseUrl: "",
};
let activeProvider = null;

// --- construcción de la UI según el proveedor -------------------------------

function fillProviderSelect() {
  const sel = $("provider");
  sel.innerHTML = "";
  for (const [id, P] of Object.entries(PROVIDERS)) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = P.labelKey ? t(P.labelKey) : P.label;
    sel.appendChild(o);
  }
}

// Muestra el campo de texto de modelo solo cuando se elige «Personalizado…».
function syncModelCustom() {
  $("modelCustom").style.display = $("model").value === "__custom__" ? "block" : "none";
}

// Devuelve el id de modelo efectivo (lista o personalizado).
function selectedModel() {
  const v = $("model").value;
  return v === "__custom__" ? $("modelCustom").value.trim() : v;
}

function populateModels(P, current) {
  const sel = $("model");
  sel.innerHTML = "";
  for (const [val, name, descKey] of (P.models || [])) {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = descKey ? `${name} (${t(descKey)})` : name;
    sel.appendChild(o);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = t("model_custom_option");
  sel.appendChild(custom);

  const known = (P.models || []).some(([v]) => v === current);
  if (current && known) {
    sel.value = current;
    $("modelCustom").value = "";
  } else if (current) {
    sel.value = "__custom__";
    $("modelCustom").value = current;
  } else {
    sel.value = "__custom__"; // proveedor sin lista (custom): obliga a escribir
    $("modelCustom").value = "";
  }
  syncModelCustom();
}

// Pinta la UI con los datos guardados del proveedor indicado.
function applyProvider(providerId) {
  const P = PROVIDERS[providerId];

  $("apiKeyLabel").textContent = P.keyName ? t("api_key_label", { name: P.keyName }) : t("api_key_optional");
  $("apiKey").placeholder = P.keyHintKey ? t(P.keyHintKey) : (P.keyHint || "");
  $("apiKey").value = state.keys[providerId] || "";

  if (P.fixedBaseUrl) {
    $("baseUrlRow").style.display = "none";
  } else {
    $("baseUrlRow").style.display = "block";
    $("baseUrl").placeholder = P.baseUrlHint || "";
    $("baseUrlHint").textContent = P.baseUrlHint || "";
    $("baseUrl").value = state.customBaseUrl || "";
  }

  populateModels(P, state.models[providerId] || P.defaultModel || "");

  if (P.jsonModeConfigurable) {
    $("jsonModeRow").style.display = "block";
    $("jsonModeHint").style.display = "block";
    const v = state.jsonMode[providerId];
    $("jsonMode").checked = typeof v === "boolean" ? v : !!P.defaultJsonMode;
  } else {
    $("jsonModeRow").style.display = "none";
    $("jsonModeHint").style.display = "none";
  }

  $("providerHint").textContent = P.fixedBaseUrl ? "" : t("custom_provider_hint");
}

// Vuelca lo escrito ahora mismo en pantalla al estado del proveedor activo.
function saveCurrentIntoState() {
  if (!activeProvider) return;
  const P = PROVIDERS[activeProvider];
  state.keys[activeProvider] = $("apiKey").value.trim();
  state.models[activeProvider] = selectedModel();
  if (!P.fixedBaseUrl) state.customBaseUrl = $("baseUrl").value.trim();
  if (P.jsonModeConfigurable) state.jsonMode[activeProvider] = $("jsonMode").checked;
}

function switchProvider(next) {
  saveCurrentIntoState(); // no perder lo del proveedor que dejamos
  activeProvider = next;
  $("provider").value = next;
  applyProvider(next);
}

$("provider").onchange = () => switchProvider($("provider").value);
$("model").onchange = syncModelCustom;

// --- carga inicial ----------------------------------------------------------

// Cambiar idioma: persiste, re-traduce el HTML estático y repinta las partes
// dinámicas (etiquetas de proveedor/modelo, que dependen del idioma).
$("lang").onchange = async () => {
  setLang($("lang").value);
  await chrome.storage.local.set({ lang: getLang() });
  applyI18n();
  fillProviderSelect();
  $("provider").value = activeProvider;
  applyProvider(activeProvider);
};

(async () => {
  await applyLangFromStore();
  applyI18n();
  $("lang").value = getLang();
  fillProviderSelect();

  const s = await chrome.storage.local.get(
    ["provider", "model", "apiKeys", "apiKey", "customBaseUrl", "jsonMode", "fallback",
     "temperature", "maxTokens", "timeoutSecs", "profile", "cvText", "cvFileName"]);

  // compat: versiones antiguas guardaban una sola `apiKey` (era de Google)
  state.keys = s.apiKeys || (s.apiKey ? { google: s.apiKey } : {});
  state.customBaseUrl = s.customBaseUrl || "";

  const provider = s.provider || DEFAULT_PROVIDER;
  if (s.model) state.models[provider] = s.model;
  if (typeof s.jsonMode === "boolean") state.jsonMode[provider] = s.jsonMode;

  $("temperature").value = typeof s.temperature === "number" ? s.temperature : 0.4;
  $("maxTokens").value = s.maxTokens || 8192;
  $("timeoutSecs").value = s.timeoutSecs || 180;
  $("fallback").checked = !!s.fallback;

  switchProvider(provider);

  $("profile").value = JSON.stringify(s.profile || DEFAULT_PROFILE, null, 2);
  $("cvText").value = s.cvText || "";
  if (s.cvFileName) $("cvFileInfo").textContent = t("cvfile_saved", { name: s.cvFileName });
})();

// --- CV: extracción de PDF (sin cambios de comportamiento) -------------------

// Extrae el texto de un PDF con pdf.js (vendorizado en vendor/). Devuelve texto
// con saltos de línea aproximados, listo para que la IA lo use.
async function extractPdfText(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.js");
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let line = "";
    for (const it of content.items) {
      line += it.str;
      if (it.hasEOL) { lines.push(line); line = ""; } // pdf.js marca fin de línea
    }
    if (line) lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Al elegir el CV: guarda el binario (para descarga rápida) y, si es PDF, extrae
// el texto y rellena «CV (texto plano)» automáticamente.
$("cvFile").onchange = async () => {
  const file = $("cvFile").files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async () => {
    await chrome.storage.local.set({ cvFile: reader.result, cvFileName: file.name });
    $("cvFileInfo").textContent = t("cvfile_saved_ok", { name: file.name, kb: Math.round(file.size / 1024) });
  };
  reader.readAsDataURL(file);

  const ext = $("cvExtract");
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    ext.textContent = t("cv_extracting");
    ext.style.color = "#718096";
    try {
      const text = await extractPdfText(file);
      if (!text) throw new Error(t("cv_no_selectable"));
      $("cvText").value = text;
      await chrome.storage.local.set({ cvText: text });
      ext.textContent = t("cv_extracted", { len: text.length });
      ext.style.color = "#2f855a";
    } catch (e) {
      ext.textContent = t("cv_extract_fail", { error: e.message || e });
      ext.style.color = "#c53030";
    }
  } else {
    ext.textContent = t("cv_only_pdf");
    ext.style.color = "#718096";
  }
};

// --- guardar ----------------------------------------------------------------

function showSaved(text, color) {
  $("saved").textContent = text;
  $("saved").style.color = color;
  if (color === "#2f855a") setTimeout(() => ($("saved").textContent = ""), 2000);
}

// Lee y normaliza temperatura, máx. tokens y timeout de las opciones avanzadas.
function readAdvanced() {
  return {
    temperature: Math.min(2, Math.max(0, parseFloat($("temperature").value)) || 0.4),
    maxTokens: Math.max(256, parseInt($("maxTokens").value, 10) || 8192),
    timeoutSecs: Math.max(10, parseInt($("timeoutSecs").value, 10) || 180),
  };
}

// Construye el objeto de config (forma de chrome.storage) del proveedor activo,
// listo para guardar o para enviar a background (probar conexión). Llama antes a
// saveCurrentIntoState(). Devuelve null y muestra error si falta algo.
function buildStore(showErr) {
  saveCurrentIntoState();
  const provider = activeProvider;
  const P = PROVIDERS[provider];
  const model = state.models[provider] || "";
  if (!model) { showErr(t("err_need_model")); return null; }
  if (!P.fixedBaseUrl && !state.customBaseUrl) { showErr(t("err_need_baseurl")); return null; }
  const adv = readAdvanced();
  return {
    provider,
    apiKeys: state.keys,
    model,
    customBaseUrl: state.customBaseUrl,
    jsonMode: P.jsonModeConfigurable ? !!state.jsonMode[provider] : null,
    fallback: $("fallback").checked,
    temperature: adv.temperature,
    maxTokens: adv.maxTokens,
    timeoutSecs: adv.timeoutSecs,
  };
}

// Para un proveedor con base URL libre, pide permiso de red a ese origen. Los
// proveedores fijos (Google/OpenAI/Anthropic) ya están en host_permissions.
async function ensureHostPermission(baseUrl) {
  let origin;
  try {
    const u = new URL(baseUrl);
    origin = `${u.protocol}//${u.host}/*`;
  } catch {
    return false; // URL inválida
  }
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

// Botón "Probar conexión": valida key/modelo/endpoint con una petición mínima.
$("test").onclick = async () => {
  const setRes = (t, color) => { $("testResult").textContent = t; $("testResult").style.color = color; };
  const store = buildStore((m) => setRes(m, "#c53030"));
  if (!store) return;
  const P = PROVIDERS[store.provider];
  if (!P.fixedBaseUrl) {
    const ok = await ensureHostPermission(store.customBaseUrl);
    if (!ok) { setRes(t("net_denied"), "#c53030"); return; }
  }
  setRes(t("test_probing"), "#718096");
  try {
    const r = await chrome.runtime.sendMessage({ action: "testConnection", store });
    if (r && r.ok) setRes(t("test_ok", { ms: r.ms, tag: r.tag }), "#2f855a");
    else setRes(t("test_fail", { error: r ? r.error : t("test_no_response") }), "#c53030");
  } catch (e) {
    setRes(t("test_fail", { error: e.message || e }), "#c53030");
  }
};

$("save").onclick = async () => {
  let profile;
  try {
    profile = JSON.parse($("profile").value);
  } catch (e) {
    showSaved(t("saved_bad_json"), "#c53030");
    return;
  }

  const store = buildStore((m) => showSaved(m, "#c53030"));
  if (!store) return;

  const P = PROVIDERS[store.provider];
  if (!P.fixedBaseUrl) {
    // Debe ejecutarse dentro del gesto del usuario (clic) para que el navegador
    // muestre el diálogo de permiso; por eso va antes de cualquier escritura.
    const ok = await ensureHostPermission(store.customBaseUrl);
    if (!ok) {
      showSaved(t("net_denied"), "#c53030");
      return;
    }
  }

  await chrome.storage.local.set({ ...store, profile, cvText: $("cvText").value });
  // Quita la clave del esquema antiguo (una sola `apiKey`) para no confundir.
  await chrome.storage.local.remove("apiKey");

  showSaved(t("saved_ok"), "#2f855a");
};
