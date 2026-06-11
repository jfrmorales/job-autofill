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

const DEFAULT_MODEL = "gemini-3.5-flash";

// Muestra el campo de texto solo cuando se elige «Personalizado…».
function syncModelCustom() {
  $("modelCustom").style.display = $("model").value === "__custom__" ? "block" : "none";
}
$("model").onchange = syncModelCustom;

// Devuelve el id de modelo efectivo (lista o personalizado).
function selectedModel() {
  const v = $("model").value;
  return v === "__custom__" ? ($("modelCustom").value.trim() || DEFAULT_MODEL) : v;
}

chrome.storage.local.get(["apiKey", "model", "profile", "cvText", "cvFileName"]).then(
  ({ apiKey, model, profile, cvText, cvFileName }) => {
    $("apiKey").value = apiKey || "";
    const m = model || DEFAULT_MODEL;
    const known = [...$("model").options].some((o) => o.value === m);
    if (known) {
      $("model").value = m;
    } else {
      $("model").value = "__custom__";
      $("modelCustom").value = m;
    }
    syncModelCustom();
    $("profile").value = JSON.stringify(profile || DEFAULT_PROFILE, null, 2);
    $("cvText").value = cvText || "";
    if (cvFileName) $("cvFileInfo").textContent = `Guardado: ${cvFileName}`;
  }
);

// guarda el PDF (como dataURL) en cuanto lo eliges
$("cvFile").onchange = () => {
  const file = $("cvFile").files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    await chrome.storage.local.set({ cvFile: reader.result, cvFileName: file.name });
    $("cvFileInfo").textContent = `✓ Guardado: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  };
  reader.readAsDataURL(file);
};

$("save").onclick = async () => {
  let profile;
  try {
    profile = JSON.parse($("profile").value);
  } catch (e) {
    $("saved").textContent = "✗ El perfil no es JSON válido";
    $("saved").style.color = "#c53030";
    return;
  }
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: selectedModel(),
    profile,
    cvText: $("cvText").value,
  });
  $("saved").style.color = "#2f855a";
  $("saved").textContent = "✓ Guardado";
  setTimeout(() => ($("saved").textContent = ""), 2000);
};
