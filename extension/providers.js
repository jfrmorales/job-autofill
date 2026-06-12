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
  if (!txt) throw new Error(`respuesta vacía (finish=${(choice && choice.finish_reason) || "?"})`);
  return txt;
}

const PROVIDERS = {
  // ----------------------------------------------------------------- Google
  google: {
    label: "Google (Gemini / Gemma)",
    keyLabel: "API key de Google AI Studio",
    keyHint: "AIza… / AQ…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.5-flash",
    models: [
      ["gemini-3.5-flash", "Gemini 3.5 Flash (rápido)"],
      ["gemini-3.5-pro", "Gemini 3.5 Pro (potente)"],
      ["gemma-4-26b-a4b-it", "Gemma 4 26B (abierto, MoE rápido)"],
      ["gemma-4-31b-it", "Gemma 4 31B (abierto, el más grande)"],
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
      if (data.promptFeedback?.blockReason) throw new Error(`prompt bloqueado (${data.promptFeedback.blockReason})`);
      const cand = data?.candidates?.[0];
      const txt = (cand?.content?.parts || [])
        .filter((p) => p && typeof p.text === "string").map((p) => p.text).join("");
      if (!txt) {
        const reason = cand?.finishReason || "sin candidatos";
        throw new Error(reason === "MAX_TOKENS"
          ? "respuesta agotó tokens pensando (sube «máx. tokens de salida»)"
          : `respuesta vacía (finishReason=${reason})`);
      }
      return txt;
    },
  },

  // ----------------------------------------------------------------- OpenAI
  openai: {
    label: "OpenAI (GPT)",
    keyLabel: "API key de OpenAI",
    keyHint: "sk-…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: [
      ["gpt-4o-mini", "GPT-4o mini (barato, rápido)"],
      ["gpt-4o", "GPT-4o"],
      ["gpt-4.1-mini", "GPT-4.1 mini"],
      ["gpt-4.1", "GPT-4.1"],
      ["o4-mini", "o4-mini (razonamiento)"],
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
    keyLabel: "API key de Anthropic",
    keyHint: "sk-ant-…",
    fixedBaseUrl: true,
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    models: [
      ["claude-haiku-4-5", "Claude Haiku 4.5 (rápido, barato)"],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6 (equilibrado)"],
      ["claude-opus-4-8", "Claude Opus 4.8 (el más potente)"],
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
      if (!txt) throw new Error(`respuesta vacía (stop=${data?.stop_reason || "?"})`);
      return txt;
    },
  },

  // -------------------------------------------- Compatible con OpenAI (libre)
  // Base URL la pone el usuario; usa el formato Chat Completions. Cubre
  // OpenRouter, Groq, Together, Mistral, DeepSeek, xAI, Ollama, LM Studio, etc.
  custom: {
    label: "Compatible con OpenAI (personalizado)",
    keyLabel: "API key (déjala vacía si el servidor no la pide)",
    keyHint: "sk-… · vacío para servidores locales",
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
  if (!P) throw new Error(`Proveedor desconocido: ${providerId}`);

  const apiKeys = store.apiKeys || (store.apiKey ? { google: store.apiKey } : {});
  const apiKey = (apiKeys[providerId] || "").trim();
  if (!apiKey && !P.allowEmptyKey) throw new Error(`Falta la API key de ${P.label} (ponla en Ajustes).`);

  const model = (store.model || P.defaultModel || "").trim();
  if (!model) throw new Error(`Falta el modelo de ${P.label} (escríbelo en Ajustes).`);

  let baseUrl = P.fixedBaseUrl ? P.defaultBaseUrl : (store.customBaseUrl || "").trim();
  if (!baseUrl) throw new Error("Falta la Base URL del proveedor personalizado (ponla en Ajustes).");
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
