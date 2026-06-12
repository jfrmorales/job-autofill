const $ = (id) => document.getElementById(id);
const status = (m) => ($("status").textContent = m);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// El pipeline (escanear → generar → rellenar) vive en el service worker para
// sobrevivir al cierre del popup. Aquí solo lo disparamos y mostramos progreso
// si el popup sigue abierto.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") status(msg.text);
});

// --- Estado persistente de la última ejecución -------------------------------
// El popup se destruye al cerrarse; el estado real vive en chrome.storage.local
// (lo escribe el service worker). Lo leemos al abrir y nos refrescamos en vivo.
const fmtTime = (ts) => new Date(ts).toLocaleTimeString();

async function renderLastRun() {
  const { lastRun, runLog } = await chrome.storage.local.get(["lastRun", "runLog"]);
  const last = $("last");
  if (!lastRun || !lastRun.state) {
    last.innerHTML = "";
  } else {
    let head, color;
    if (lastRun.state === "running") {
      head = `⏳ En curso desde ${fmtTime(lastRun.startedAt)}…`; color = "#2b6cb0";
    } else if (lastRun.state === "error") {
      head = `✗ Error (${fmtTime(lastRun.finishedAt)}): ${lastRun.error || ""}`; color = "#c53030";
    } else {
      const r = lastRun.result || {};
      head = `✓ Terminado ${fmtTime(lastRun.finishedAt)} — ${r.ok || 0} ok` +
        (r.fail ? `, ${r.fail} fallo(s)` : "") + (r.files ? `, ${r.files} fichero` : "");
      color = "#2f855a";
    }
    let rows = "";
    for (const d of (lastRun.result?.details || [])) {
      const icon = d.status === "ok" ? "✓" : d.status === "fail" ? "✗" : d.status === "file" ? "⬇" : "·";
      const col = d.status === "ok" ? "#2f855a" : d.status === "fail" ? "#c53030"
        : d.status === "file" ? "#c05621" : "#718096";
      const tail = d.reason ? ` — ${d.reason}` : "";
      rows += `<div style="color:${col}">${icon} ${escapeHtml(d.label)}${escapeHtml(tail)}</div>`;
    }
    last.innerHTML = `<div class="head" style="color:${color}">${escapeHtml(head)}</div>` +
      (rows ? `<div class="fields">${rows}</div>` : "");
  }
  const lines = (runLog || []).map((e) => {
    const mark = e.level === "error" ? "✗" : e.level === "warn" ? "⚠" : e.level === "ok" ? "✓" : "·";
    return `${fmtTime(e.ts)} ${mark} ${e.text}`;
  });
  $("log").textContent = lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// refresco en vivo: cuando el SW actualiza el estado, repintamos
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.lastRun || changes.runLog)) renderLastRun();
});

$("togglelog").onclick = () => {
  const l = $("log");
  const show = l.style.display === "none";
  l.style.display = show ? "block" : "none";
  $("togglelog").textContent = show ? "Ocultar registro" : "Ver registro";
};

$("copylog").onclick = async () => {
  const { runLog } = await chrome.storage.local.get("runLog");
  const txt = (runLog || []).map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.text}`).join("\n");
  if (!txt) { status("No hay registro todavía."); return; }
  try { await navigator.clipboard.writeText(txt); status("📋 Registro copiado al portapapeles."); }
  catch { status("No pude copiar el registro (permiso de portapapeles)."); }
};

renderLastRun();

$("scan").onclick = async () => {
  try {
    const tab = await activeTab();
    const res = await chrome.runtime.sendMessage({ action: "scanOnly", tabId: tab.id, tabUrl: tab.url });
    const fields = res?.fields || [];
    if (!fields.length) {
      status("0 campos. Pulsa «Apply» para abrir el formulario y reintenta.");
      return;
    }
    const fillable = fields.filter((f) => f.type !== "file").length;
    const files = fields.filter((f) => f.type === "file").length;
    status(`Detectados ${fields.length} campos (${fillable} rellenables, ${files} de fichero/manual).`);
  } catch (e) {
    status("No pude leer la página. ¿Es una pestaña web normal?");
  }
};

$("fill").onclick = async () => {
  $("fill").disabled = true;
  try {
    const tab = await activeTab();
    status("Trabajando… puedes cerrar esta ventana; sigue en segundo plano.");
    // El SW completa el relleno aunque cierres el popup. Si sigue abierto,
    // recibimos el resumen final aquí; si no, queda en el badge del icono.
    const r = await chrome.runtime.sendMessage({ action: "run", tabId: tab.id, tabUrl: tab.url });
    if (!r) return; // popup reabierto sin respuesta pendiente
    status(r.ok ? r.summary : "Error: " + r.error);
  } catch (e) {
    // El popup pudo cerrarse durante el trabajo: no es un fallo real.
    status("Error: " + (e.message || e));
  } finally {
    $("fill").disabled = false;
  }
};

// --- CV a mano ---
$("cvdl").onclick = async () => {
  const { cvFile, cvFileName } = await chrome.storage.local.get(["cvFile", "cvFileName"]);
  if (!cvFile) { status("No hay PDF guardado. Cárgalo en «Ajustes»."); return; }
  chrome.downloads.download({ url: cvFile, filename: cvFileName || "CV.pdf", saveAs: false });
  status(`⬇ ${cvFileName || "CV"} guardado en Descargas; ya puedes adjuntarlo.`);
};

$("cvcopy").onclick = async () => {
  const { cvText } = await chrome.storage.local.get("cvText");
  if (!cvText) { status("No hay texto de CV. Pégalo en «Ajustes»."); return; }
  try {
    await navigator.clipboard.writeText(cvText);
    status("📋 Texto del CV copiado al portapapeles.");
  } catch {
    status("No pude copiar (permiso de portapapeles).");
  }
};

$("opts").onclick = () => chrome.runtime.openOptionsPage();

// aviso si falta config (proveedor + key + modelo válidos, y perfil)
chrome.storage.local.get(
  ["provider", "apiKeys", "apiKey", "model", "customBaseUrl", "jsonMode", "profile"]
).then((s) => {
  let configOk = true;
  try { resolveProviderConfig(s); } catch { configOk = false; }
  if (!configOk || !s.profile) {
    status("⚙ Configura proveedor, API key y perfil en «Ajustes» primero.");
  }
});
