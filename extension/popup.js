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

// aviso si falta config
chrome.storage.local.get(["apiKey", "profile"]).then(({ apiKey, profile }) => {
  if (!apiKey || !profile) status("⚙ Configura tu API key y perfil en «Ajustes» primero.");
});
