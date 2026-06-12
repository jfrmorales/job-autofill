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

// ------------------------------------------------------------------ escaneo
function scan() {
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
    const t = (el.type || "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "password"].includes(t)) return;
    if (!isVisible(el)) return;

    if (t === "file") {
      push(out, { el, type: "file" }, { label: clean(labelFor(el)), type: "file", note: "súbelo tú (el navegador no deja por seguridad)" });
      return;
    }
    if (t === "radio") {
      if (!el.name || seenRadioGroups.has(el.name)) return;
      seenRadioGroups.add(el.name);
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)];
      const options = group.map((r) => clean(labelFor(r)));
      const grpLabel = clean(groupLabel(el) || el.name);
      push(out, { el, type: "radio", optionEls: group, optionLabels: options }, { label: grpLabel, type: "select", options });
      return;
    }
    if (t === "checkbox") {
      push(out, { el, type: "checkbox" }, { label: clean(labelFor(el)), type: "boolean" });
      return;
    }
    // text/email/tel/url/number/search — conserva el subtipo para guiar al modelo
    const sub = ["number", "email", "tel", "url", "date"].includes(t) ? t : "text";
    push(out, { el, type: "text", inputType: t }, { label: clean(labelFor(el)), type: sub });
  });

  // react-select (Greenhouse/Ashby): combobox sin <select> nativo
  document.querySelectorAll('[class*="select__control"], [role="combobox"]').forEach((el) => {
    if (!isVisible(el)) return;
    // evita duplicar si ya hay un select nativo hermano
    if (el.closest("label,div")?.querySelector("select")) return;
    push(out, { el, type: "reactselect" }, { label: clean(labelFor(el)) || nearbyLabel(el), type: "select", options: [] });
  });

  return out;
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

async function fillReactSelect(controlEl, value) {
  controlEl.scrollIntoView({ block: "center" });
  controlEl.click();
  await sleep(250);
  // intenta teclear para filtrar
  const input = controlEl.querySelector("input") || document.activeElement;
  if (input && input.tagName === "INPUT") setNativeValue(input, value);
  await sleep(300);
  // clica la opción cuyo texto coincide
  const opts = [...document.querySelectorAll('[class*="option"], [role="option"]')];
  const match = opts.find((o) => o.textContent.trim().toLowerCase() === value.toLowerCase())
    || opts.find((o) => o.textContent.trim().toLowerCase().includes(value.toLowerCase()));
  if (match) { match.click(); return true; }
  return false;
}

async function fill(answers) {
  let ok = 0, fail = 0;
  const details = []; // {index, label, status: ok|fail|skip|file, reason?, value?}
  for (const [idxStr, value] of Object.entries(answers)) {
    const idx = Number(idxStr);
    const f = FIELD_MAP[idx];
    if (!f) {
      details.push({ index: idx, label: "(campo no encontrado)", status: "fail", reason: "índice fuera del formulario escaneado" });
      fail++; continue;
    }
    if (value === "" || value == null) {
      details.push({ index: idx, label: f.label, status: "skip", reason: "la IA no devolvió valor" });
      continue;
    }
    try {
      if (f.type === "text" || f.type === "textarea") {
        f.el.scrollIntoView({ block: "center" });
        let v = String(value);
        if (f.inputType === "number") {
          v = toNumber(v);
          if (!v) throw new Error("valor no numérico para campo number");
        }
        setNativeValue(f.el, v);
      } else if (f.type === "select") {
        const sel = f.el;
        const opt = [...sel.options].find((o) => o.textContent.trim().toLowerCase() === String(value).toLowerCase())
          || [...sel.options].find((o) => o.textContent.trim().toLowerCase().includes(String(value).toLowerCase()));
        if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        else throw new Error("opción no encontrada");
      } else if (f.type === "radio") {
        const i = f.optionLabels.findIndex((l) => l.toLowerCase() === String(value).toLowerCase()
          || l.toLowerCase().includes(String(value).toLowerCase()));
        if (i >= 0) { f.optionEls[i].click(); } else throw new Error("opción radio no encontrada");
      } else if (f.type === "checkbox") {
        const want = String(value).toLowerCase() === "true";
        if (f.el.checked !== want) f.el.click();
      } else if (f.type === "reactselect") {
        const done = await fillReactSelect(f.el, String(value));
        if (!done) throw new Error("react-select no resuelto");
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
    details.push({ index: -1, label: f.label, status: "file", reason: "adjúntalo a mano (el navegador no deja por seguridad)" });
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
  if (msg.action === "scan") {
    let fields = scan();
    if (fields.length) { sendResponse({ fields, pageText: pageText(), url: location.href }); return; }
    // sin campos: intenta desplegar el form y reescanea
    tryRevealForm().then(() => {
      sendResponse({ fields: scan(), pageText: pageText(), url: location.href });
    });
    return true; // async
  } else if (msg.action === "fill") {
    fill(msg.answers).then((r) => sendResponse(r));
    return true; // async
  }
  return true;
});
