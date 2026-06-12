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
      head = t("run_running", { time: fmtTime(lastRun.startedAt) }); color = "#2b6cb0";
    } else if (lastRun.state === "error") {
      head = t("run_error", { time: fmtTime(lastRun.finishedAt), error: lastRun.error || "" }); color = "#c53030";
    } else {
      const r = lastRun.result || {};
      head = t("run_done", { time: fmtTime(lastRun.finishedAt), ok: r.ok || 0 }) +
        (r.fail ? t("run_done_fail", { fail: r.fail }) : "") +
        (r.files ? t("run_done_files", { files: r.files }) : "");
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
  $("togglelog").textContent = show ? t("btn_hidelog") : t("btn_showlog");
};

$("copylog").onclick = async () => {
  const { runLog } = await chrome.storage.local.get("runLog");
  const txt = (runLog || []).map((e) => `${new Date(e.ts).toISOString()} [${e.level}] ${e.text}`).join("\n");
  if (!txt) { status(t("log_empty")); return; }
  try { await navigator.clipboard.writeText(txt); status(t("log_copied")); }
  catch { status(t("log_copy_fail")); }
};

// Arranque: fija el idioma (guardado o autodetectado), traduce el HTML estático,
// pinta el estado de la última ejecución y avisa si falta configuración.
(async () => {
  await applyLangFromStore();
  applyI18n();
  renderLastRun();

  // aviso si falta config (proveedor + key + modelo válidos, y perfil)
  const s = await chrome.storage.local.get(
    ["provider", "apiKeys", "apiKey", "model", "customBaseUrl", "jsonMode", "profile"]);
  let configOk = true;
  try { resolveProviderConfig(s); } catch { configOk = false; }
  if (!configOk || !s.profile) status(t("config_missing"));
})();

$("scan").onclick = async () => {
  try {
    const tab = await activeTab();
    const res = await chrome.runtime.sendMessage({ action: "scanOnly", tabId: tab.id, tabUrl: tab.url });
    const fields = res?.fields || [];
    if (!fields.length) {
      status(t("scan_zero"));
      return;
    }
    const fillable = fields.filter((f) => f.type !== "file").length;
    const files = fields.filter((f) => f.type === "file").length;
    status(t("scan_result", { total: fields.length, fillable, files }));
  } catch (e) {
    status(t("scan_unreadable"));
  }
};

$("fill").onclick = async () => {
  $("fill").disabled = true;
  try {
    const tab = await activeTab();
    status(t("working"));
    // El SW completa el relleno aunque cierres el popup. Si sigue abierto,
    // recibimos el resumen final aquí; si no, queda en el badge del icono.
    const r = await chrome.runtime.sendMessage({ action: "run", tabId: tab.id, tabUrl: tab.url });
    if (!r) return; // popup reabierto sin respuesta pendiente
    status(r.ok ? r.summary : t("error_prefix") + r.error);
  } catch (e) {
    // El popup pudo cerrarse durante el trabajo: no es un fallo real.
    status(t("error_prefix") + (e.message || e));
  } finally {
    $("fill").disabled = false;
  }
};

// --- CV a mano ---
$("cvdl").onclick = async () => {
  const { cvFile, cvFileName } = await chrome.storage.local.get(["cvFile", "cvFileName"]);
  if (!cvFile) { status(t("cv_no_pdf")); return; }
  chrome.downloads.download({ url: cvFile, filename: cvFileName || "CV.pdf", saveAs: false });
  status(t("cv_downloaded", { name: cvFileName || "CV" }));
};

$("cvcopy").onclick = async () => {
  const { cvText } = await chrome.storage.local.get("cvText");
  if (!cvText) { status(t("cv_no_text")); return; }
  try {
    await navigator.clipboard.writeText(cvText);
    status(t("cv_copied"));
  } catch {
    status(t("cv_copy_fail"));
  }
};

$("opts").onclick = () => chrome.runtime.openOptionsPage();
