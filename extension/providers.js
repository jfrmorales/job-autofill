// providers.js — registro de proveedores de IA, COMPARTIDO por el service worker
// (background.js lo carga con importScripts) y la página de Ajustes (options.html
// lo carga con <script>). Es la única fuente de verdad: añadir un proveedor nuevo
// es añadir una entrada aquí; ni background.js ni options.js cambian.
//
// Cada proveedor describe cómo hablar con su API:
//   endpoint(base, model) -> URL del POST
//   headers(apiKey)       -> cabeceras (auth incluida)
//   body(model, prompt, opts) -> cuerpo JSON de la petición
//   extract(data)         -> texto de la respuesta (o lanza Error con el motivo)
// y metadatos de UI (label, modelos sugeridos, si la base URL es fija, etc.).

// --- Formato OpenAI Chat Completions ----------------------------------------
// Lo comparten OpenAI y prácticamente todos los servicios "compatibles":
// OpenRouter, Groq, Together, Mistral, DeepSeek, xAI (Grok), Ollama, LM Studio,
// vLLM, LocalAI… Por eso el proveedor "custom" (base URL libre + este formato)
// cubre casi cualquier API del mercado con una sola implementación.
// Modelos de razonamiento de OpenAI (o1, o3, o4-mini…): usan
// max_completion_tokens en vez de max_tokens y no admiten temperature != 1.
function isReasoningModel(model) {
  return /^o[1-9]/.test(model || "");
}
function openaiChatBody(model, prompt, opts) {
  const body = { model, messages: [{ role: "user", content: prompt }] };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = opts.maxTokens;
  } else {
    body.temperature = opts.temperature;
    body.max_tokens = opts.maxTokens;
  }
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  return body;
}
function openaiChatExtract(data) {
  const choice = data && data.choices && data.choices[0];
  const txt = choice && choice.message && choice.message.content;
  if (!txt) throw new Error(t("prov_empty", { reason: (choice && choice.finish_reason) || "?" }));
  return txt;
}

const PROVIDERS = {
  // ----------------------------------------------------------------- Google
  google: {
    label: "Google (Gemini / Gemma)",
    keyName: "Google AI Studio",
    keyHint: "AIza… / AQ…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.5-flash",
    // [id, nombre, clave-i18n de la descripción opcional]
    models: [
      ["gemini-3.5-flash", "Gemini 3.5 Flash", "m_fast"],
      ["gemini-3.5-pro", "Gemini 3.5 Pro", "m_powerful"],
      ["gemma-4-26b-a4b-it", "Gemma 4 26B", "m_open_moe"],
      ["gemma-4-31b-it", "Gemma 4 31B", "m_open_largest"],
    ],
    jsonModeConfigurable: false,
    endpoint: (base, model) => `${base}/models/${model}:generateContent`,
    headers: (key) => ({ "Content-Type": "application/json", "x-goog-api-key": key }),
    body: (model, prompt, opts) => {
      const gc = { temperature: opts.temperature, maxOutputTokens: opts.maxTokens };
      // Gemma no soporta responseMimeType (JSON mode); el prompt ya pide JSON y
      // de todos modos extraemos el objeto del texto.
      if (!model.startsWith("gemma")) gc.responseMimeType = "application/json";
      return { contents: [{ parts: [{ text: prompt }] }], generationConfig: gc };
    },
    extract: (data) => {
      if (data.promptFeedback?.blockReason) throw new Error(t("prov_blocked", { reason: data.promptFeedback.blockReason }));
      const cand = data?.candidates?.[0];
      const txt = (cand?.content?.parts || [])
        .filter((p) => p && typeof p.text === "string").map((p) => p.text).join("");
      if (!txt) {
        const reason = cand?.finishReason || t("prov_no_candidates");
        throw new Error(reason === "MAX_TOKENS" ? t("prov_max_tokens") : t("prov_empty", { reason }));
      }
      return txt;
    },
  },

  // ----------------------------------------------------------------- OpenAI
  openai: {
    label: "OpenAI (GPT)",
    keyName: "OpenAI",
    keyHint: "sk-…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      ["gpt-4o-mini", "GPT-4o mini", "m_cheap_fast"],
      ["gpt-4o", "GPT-4o", null],
      ["gpt-4.1-mini", "GPT-4.1 mini", null],
      ["gpt-4.1", "GPT-4.1", null],
      ["o4-mini", "o4-mini", "m_reasoning"],
    ],
    jsonModeConfigurable: true,
    defaultJsonMode: true,
    endpoint: (base) => `${base}/chat/completions`,
    headers: (key) => ({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }),
    body: openaiChatBody,
    extract: openaiChatExtract,
  },

  // -------------------------------------------------------------- Anthropic
  anthropic: {
    label: "Anthropic (Claude)",
    keyName: "Anthropic",
    keyHint: "sk-ant-…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    models: [
      ["claude-haiku-4-5", "Claude Haiku 4.5", "m_cheap_fast"],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6", "m_balanced"],
      ["claude-opus-4-8", "Claude Opus 4.8", "m_strongest"],
    ],
    jsonModeConfigurable: false,
    endpoint: (base) => `${base}/messages`,
    headers: (key) => ({
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      // Necesario para llamar al API de Anthropic directamente desde el navegador
      // (extensión); sin esto la API rechaza la petición por CORS.
      "anthropic-dangerous-direct-browser-access": "true",
    }),
    body: (model, prompt, opts) => ({
      model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: [{ role: "user", content: prompt }],
    }),
    extract: (data) => {
      const txt = (data?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!txt) throw new Error(t("prov_empty", { reason: data?.stop_reason || "?" }));
      return txt;
    },
  },

  // -------------------------------------------- Compatible con OpenAI (libre)
  // Base URL la pone el usuario; usa el formato Chat Completions. Cubre
  // OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama, LM Studio, etc.
  custom: {
    label: "OpenAI-compatible (custom)",
    labelKey: "provider_custom",       // el desplegable lo traduce con t()
    keyName: null,                      // sin marca: usa la etiqueta «API key (opcional)»
    keyHintKey: "key_hint_custom",      // placeholder traducible
    fixedBaseUrl: false,
    baseUrlHint: "https://openrouter.ai/api/v1 · https://api.groq.com/openai/v1 · http://localhost:11434/v1",
    defaultBaseUrl: "",
    defaultModel: "",
    models: [], // el id depende del servidor: lo escribe el usuario
    allowEmptyKey: true,
    jsonModeConfigurable: true,
    defaultJsonMode: false, // algunos servidores rechazan response_format
    endpoint: (base) => `${base}/chat/completions`,
    headers: (key) => {
      const h = { "Content-Type": "application/json" };
      if (key) h.Authorization = `Bearer ${key}`;
      return h;
    },
    body: openaiChatBody,
    extract: openaiChatExtract,
  },
};

const DEFAULT_PROVIDER = "google";

// Convierte lo guardado en chrome.storage.local en la config efectiva que usa
// generate(). Centraliza la compatibilidad hacia atrás (versiones antiguas
// guardaban una sola `apiKey`, que era de Google) y la validación.
function resolveProviderConfig(store) {
  const providerId = store.provider || DEFAULT_PROVIDER;
  const P = PROVIDERS[providerId];
  if (!P) throw new Error(t("prov_unknown", { provider: providerId }));

  const apiKeys = store.apiKeys || (store.apiKey ? { google: store.apiKey } : {});
  const apiKey = (apiKeys[providerId] || "").trim();
  if (!apiKey && !P.allowEmptyKey) throw new Error(t("prov_missing_key", { label: P.label }));

  const model = (store.model || P.defaultModel || "").trim();
  if (!model) throw new Error(t("prov_missing_model", { label: P.label }));

  let baseUrl = P.fixedBaseUrl ? P.defaultBaseUrl : (store.customBaseUrl || "").trim();
  if (!baseUrl) throw new Error(t("prov_missing_baseurl"));
  baseUrl = baseUrl.replace(/\/+$/, ""); // sin barra final

  const jsonMode = P.jsonModeConfigurable
    ? (typeof store.jsonMode === "boolean" ? store.jsonMode : !!P.defaultJsonMode)
    : false;

  return {
    provider: providerId,
    P,
    apiKey,
    model,
    baseUrl,
    jsonMode,
    temperature: typeof store.temperature === "number" ? store.temperature : 0.4,
    maxTokens: Number(store.maxTokens) > 0 ? Number(store.maxTokens) : 8192,
  };
}
