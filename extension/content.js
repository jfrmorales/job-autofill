// content.js — escanea el formulario de la página actual y lo rellena.
// Pasivo: no hace nada hasta que el popup envía un mensaje.

let FIELD_MAP = []; // índice -> { el, type, name, optionEls? }

// ---------------------------------------------------------------- utilidades
function isVisible(el) {
  if (!el || el.disabled) return false;
  const s = window.getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function labelFor(el) {
  // 1) <label for="id">
  if (el.id) {
    const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (l && l.innerText.trim()) return l.innerText.trim();
  }
  // 2) envuelto en <label>
  const wrap = el.closest("label");
  if (wrap && wrap.innerText.trim()) return wrap.innerText.trim();
  // 3) aria
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
  const lb = el.getAttribute("aria-labelledby");
  if (lb) {
    const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
    if (t) return t;
  }
  // 4) etiqueta hermana/ancestro cercana
  let node = el;
  for (let i = 0; i < 4 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const lab = node.querySelector("label, .label, legend");
    if (lab && lab.innerText.trim() && lab.innerText.length < 200) return lab.innerText.trim();
  }
  // 5) placeholder / name
  return (el.getAttribute("placeholder") || el.name || "").trim();
}

function clean(s) {
  return (s || "").replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim();
}

// ¿`el` pertenece a un widget ya capturado? El selector de react-select casa
// varios nodos anidados del mismo widget (contenedor + input interno); este
// nodo es duplicado si es uno ya visto o contiene/está contenido por uno.
function isNestedDuplicate(el, seen) {
  return seen.some((s) => s === el || s.contains(el) || el.contains(s));
}

// ------------------------------------------------------------------ escaneo
async function scan() {
  FIELD_MAP = [];
  const out = [];
  const seenRadioGroups = new Set();

  // selects nativos
  document.querySelectorAll("select").forEach((el) => {
    if (!isVisible(el)) return;
    const options = [...el.options].map((o) => o.textContent.trim()).filter((t) => t && !/^select|^choose|^--/i.test(t));
    push(out, { el, type: "select" }, { label: clean(labelFor(el)), type: "select", options });
  });

  // textareas (detecta los de CV/resume para rellenarlos con el texto del CV)
  document.querySelectorAll("textarea").forEach((el) => {
    if (!isVisible(el)) return;
    const label = clean(labelFor(el));
    const resume = /resume|\bcv\b|curr[ií]cul|résum/i.test(label + " " + (el.name || ""));
    push(out, { el, type: "textarea" }, { label, type: "textarea", resume });
  });

  // inputs
  document.querySelectorAll("input").forEach((el) => {
    const ty = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "password"].includes(ty)) return;
    if (!isVisible(el)) return;

    if (ty === "file") {
      push(out, { el, type: "file" }, { label: clean(labelFor(el)), type: "file", note: t("c_upload_manual") });
      return;
    }
    if (ty === "radio") {
      if (!el.name || seenRadioGroups.has(el.name)) return;
      seenRadioGroups.add(el.name);
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      const options = group.map((r) => clean(labelFor(r)));
      const grpLabel = clean(groupLabel(el) || el.name);
      push(out, { el, type: "radio", optionEls: group, optionLabels: options }, { label: grpLabel, type: "select", options });
      return;
    }
    if (ty === "checkbox") {
      push(out, { el, type: "checkbox" }, { label: clean(labelFor(el)), type: "boolean" });
      return;
    }
    // text/email/tel/url/number/search — conserva el subtipo para guiar al modelo
    const sub = ["number", "email", "tel", "url", "date"].includes(ty) ? ty : "text";
    push(out, { el, type: "text", inputType: ty }, { label: clean(labelFor(el)), type: sub });
  });

  // react-select (Greenhouse/Ashby): combobox sin <select> nativo. El selector
  // puede capturar VARIOS nodos anidados del MISMO widget (el contenedor
  // .select__control y su <input role="combobox"> interno), así que dedupimos
  // por widget para no escanear/rellenar/registrar el campo dos veces.
  const rsSeen = [];
  const rsEls = [...document.querySelectorAll('[class*="select__control"], [role="combobox"]')].filter((el) => {
    if (!isVisible(el)) return false;
    // evita duplicar si ya hay un select nativo hermano
    if (el.closest("label,div")?.querySelector("select")) return false;
    // mismo widget ya capturado: este nodo contiene o está contenido por otro
    if (isNestedDuplicate(el, rsSeen)) return false;
    rsSeen.push(el);
    return true;
  });
  for (const el of rsEls) {
    // abre el desplegable para leer sus opciones (las estáticas); así el modelo
    // elige un valor que existe. Los typeahead asíncronos devuelven [] (sin daño).
    const options = await readReactSelectOptions(el);
    push(out, { el, type: "reactselect" }, { label: clean(labelFor(el)) || nearbyLabel(el), type: "select", options });
  }

  return out;
}

// Abre un react-select, lee sus opciones renderizadas y lo cierra sin elegir.
// Best-effort: los typeahead que solo cargan al teclear devuelven [].
const RS_NOISE = /^(no options|type to search|loading|start typing|sin opciones|escribe|cargando|buscando)/i;
async function readReactSelectOptions(controlEl) {
  try {
    controlEl.click();
    let opts = [];
    for (let i = 0; i < 6 && !opts.length; i++) {
      await sleep(120);
      opts = [...document.querySelectorAll('[class*="option"], [role="option"]')];
    }
    const labels = [...new Set(opts.map((o) => clean(o.textContent)).filter(Boolean))]
      .filter((s) => !RS_NOISE.test(s))
      .slice(0, 50);
    // cierra el desplegable sin seleccionar nada
    const inp = controlEl.matches('[role="combobox"]') ? controlEl : controlEl.querySelector('input,[role="combobox"]');
    (inp || controlEl).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true }));
    if (inp && inp.blur) inp.blur();
    await sleep(60);
    return labels;
  } catch {
    return [];
  }
}

function push(out, internal, meta) {
  if (!meta.label) return;
  const index = FIELD_MAP.length;
  internal.label = meta.label; // guardamos la etiqueta para poder reportar por campo en fill()
  FIELD_MAP.push(internal);
  out.push({ index, required: !!internal.el.required, name: internal.el.name || "", ...meta });
}

function groupLabel(radioEl) {
  const fs = radioEl.closest("fieldset");
  if (fs) {
    const lg = fs.querySelector("legend");
    if (lg) return lg.innerText;
  }
  return nearbyLabel(radioEl);
}

function nearbyLabel(el) {
  let node = el;
  for (let i = 0; i < 5 && node; i++) {
    node = node.parentElement;
    const lab = node?.querySelector("label, legend, .label, [class*='label']");
    if (lab && lab.innerText.trim() && lab.innerText.length < 200) return lab.innerText.trim();
  }
  return "";
}

// ------------------------------------------------------------------ relleno
function setNativeValue(el, value) {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "65,000 - 75,000 EUR/año" -> "65000". Toma el primer número del texto y le
// quita moneda y separadores de miles, para inputs type=number que rechazan texto.
function toNumber(s) {
  const firstChunk = String(s).split(/[-–—]|\bto\b|\ba\b/i)[0]; // antes del guion del rango
  const digits = firstChunk.replace(/[^\d]/g, "");
  return digits || null;
}

// Teclea en un input de react-select SIN disparar blur (que cerraría el menú);
// solo 'input', que es lo que dispara la búsqueda/filtrado del combobox.
function typeIntoInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fillReactSelect(controlEl, value) {
  controlEl.scrollIntoView({ block: "center" });
  controlEl.click();
  await sleep(200);
  // teclea para filtrar (imprescindible en los typeahead que cargan por red)
  const input = controlEl.querySelector("input")
    || (document.activeElement && document.activeElement.tagName === "INPUT" ? document.activeElement : null);
  if (input) typeIntoInput(input, String(value));
  const want = String(value).toLowerCase().trim();
  // sondea hasta ~4s a que aparezcan/carguen las opciones y casa con el valor
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    const opts = [...document.querySelectorAll('[class*="option"], [role="option"]')]
      .filter((o) => o.textContent && o.textContent.trim() && !RS_NOISE.test(o.textContent.trim()));
    if (opts.length) {
      const match = opts.find((o) => o.textContent.trim().toLowerCase() === want)
        || opts.find((o) => o.textContent.trim().toLowerCase().includes(want))
        || opts.find((o) => want.includes(o.textContent.trim().toLowerCase()));
      if (match) { match.click(); return true; }
    }
  }
  return false;
}

async function fill(answers) {
  let ok = 0, fail = 0;
  const details = []; // {index, label, status: ok|fail|skip|file, reason?, value?}
  for (const [idxStr, value] of Object.entries(answers)) {
    const idx = Number(idxStr);
    const f = FIELD_MAP[idx];
    if (!f) {
      details.push({ index: idx, label: t("c_field_not_found"), status: "fail", reason: t("c_index_oob") });
      fail++; continue;
    }
    if (value === "" || value == null) {
      details.push({ index: idx, label: f.label, status: "skip", reason: t("c_no_value") });
      continue;
    }
    try {
      if (f.type === "text" || f.type === "textarea") {
        f.el.scrollIntoView({ block: "center" });
        let v = String(value);
        if (f.inputType === "number") {
          v = toNumber(v);
          if (!v) throw new Error(t("c_not_numeric"));
        }
        setNativeValue(f.el, v);
      } else if (f.type === "select") {
        const sel = f.el;
        const opt = [...sel.options].find((o) => o.textContent.trim().toLowerCase() === String(value).toLowerCase())
          || [...sel.options].find((o) => o.textContent.trim().toLowerCase().includes(String(value).toLowerCase()));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        else throw new Error(t("c_option_not_found"));
      } else if (f.type === "radio") {
        const i = f.optionLabels.findIndex((l) => l.toLowerCase() === String(value).toLowerCase()
          || l.toLowerCase().includes(String(value).toLowerCase()));
        if (i >= 0) { f.optionEls[i].click(); } else throw new Error(t("c_radio_not_found"));
      } else if (f.type === "checkbox") {
        const want = String(value).toLowerCase() === "true";
        if (f.el.checked !== want) f.el.click();
      } else if (f.type === "reactselect") {
        const done = await fillReactSelect(f.el, String(value));
        if (!done) throw new Error(t("c_reactselect_failed"));
      } else {
        continue; // file -> manual
      }
      f.el.style.outline = "2px solid #38a169";
      ok++;
      details.push({ index: idx, label: f.label, status: "ok", value: String(value).slice(0, 80) });
    } catch (e) {
      f.el.style.outline = "2px solid #e53e3e";
      fail++;
      details.push({ index: idx, label: f.label, status: "fail", reason: String(e.message || e), value: String(value).slice(0, 80) });
    }
  }
  // resalta los campos de subir fichero (hay que adjuntarlos a mano) y baja al primero
  const files = FIELD_MAP.filter((f) => f.type === "file");
  files.forEach((f) => {
    f.el.style.outline = "3px dashed #dd6b20";
    details.push({ index: -1, label: f.label, status: "file", reason: t("c_attach_manual") });
  });
  if (files.length) files[0].el.scrollIntoView({ block: "center" });
  return { ok, fail, files: files.length, details };
}

function pageText() {
  const main = document.querySelector("main, article, [role=main]") || document.body;
  return (main.innerText || "").replace(/\s+\n/g, "\n").slice(0, 6000);
}

// intenta abrir un formulario plegado (botón "Apply" in-page, sin navegar fuera).
// Solo una vez por carga, para no togglear/cerrar el form en reintentos.
let revealedOnce = false;
async function tryRevealForm() {
  if (revealedOnce) return false;
  revealedOnce = true;
  const rx = /\bapply\b|aplicar|solicitar|inscrib|postular|candidat/i;
  const cands = [...document.querySelectorAll("button, [role=button], a")].filter(
    (el) => isVisible(el) && rx.test((el.innerText || el.value || "").trim())
  );
  // solo elementos que NO naveguen a otra página (botones, o <a href="#">)
  const safe = cands.find((el) => el.tagName !== "A")
    || cands.find((el) => ((el.getAttribute("href") || "").trim().startsWith("#")));
  if (!safe) return false;
  safe.click();
  await sleep(1200);
  return true;
}

// --------------------------------------------------------------- mensajería
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Fija el idioma (para los motivos por campo) antes de escanear/rellenar.
  (async () => {
    await applyLangFromStore();
    if (msg.action === "scan") {
      let fields = await scan();
      if (!fields.length) {
        await tryRevealForm(); // sin campos: intenta desplegar el form y reescanea
        fields = await scan();
      }
      sendResponse({ fields, pageText: pageText(), url: location.href });
    } else if (msg.action === "fill") {
      sendResponse(await fill(msg.answers));
    }
  })();
  return true; // async
});
