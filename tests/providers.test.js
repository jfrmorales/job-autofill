// Tests del registro de proveedores de la extensión (extension/providers.js):
// cuerpos de petición, parsers de streaming y resolución de config.
const test = require("node:test");
const assert = require("node:assert");
const { loadExtension } = require("./_load.js");

const t = (k) => k; // stub de i18n (los mensajes no importan aquí)
const P = loadExtension(
  ["providers.js"],
  ["PROVIDERS", "DEFAULT_PROVIDER", "resolveProviderConfig", "openaiChatBody",
   "googleStreamDelta", "openaiStreamDelta", "anthropicStreamDelta", "isReasoningModel"],
  { t }
);

test("openaiChatBody: modelo normal lleva temperature y max_tokens", () => {
  const b = P.openaiChatBody("gpt-4o-mini", "hola", { temperature: 0.4, maxTokens: 100, jsonMode: false });
  assert.equal(b.temperature, 0.4);
  assert.equal(b.max_tokens, 100);
  assert.ok(!("max_completion_tokens" in b));
  assert.ok(!("response_format" in b));
});

test("openaiChatBody: modelo de razonamiento usa max_completion_tokens y sin temperature", () => {
  assert.equal(P.isReasoningModel("o4-mini"), true);
  const b = P.openaiChatBody("o4-mini", "hola", { temperature: 0.4, maxTokens: 256, jsonMode: true });
  assert.equal(b.max_completion_tokens, 256);
  assert.ok(!("temperature" in b));
  assert.deepEqual(b.response_format, { type: "json_object" });
});

test("streamDelta openai: extrae el delta de contenido", () => {
  assert.equal(P.openaiStreamDelta({ choices: [{ delta: { content: "Hola" } }] }), "Hola");
  assert.equal(P.openaiStreamDelta({ choices: [{ delta: { role: "assistant" } }] }), "");
  assert.equal(P.openaiStreamDelta({}), "");
});

test("streamDelta google: concatena los text de parts", () => {
  assert.equal(P.googleStreamDelta({ candidates: [{ content: { parts: [{ text: "Ho" }, { text: "la" }] } }] }), "Hola");
  assert.equal(P.googleStreamDelta({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] }), "");
  assert.equal(P.googleStreamDelta({}), "");
});

test("streamDelta anthropic: solo content_block_delta de texto", () => {
  assert.equal(P.anthropicStreamDelta({ type: "content_block_delta", delta: { type: "text_delta", text: "Hola" } }), "Hola");
  assert.equal(P.anthropicStreamDelta({ type: "message_start" }), "");
  assert.equal(P.anthropicStreamDelta({ type: "message_delta", delta: { stop_reason: "end_turn" } }), "");
});

test("resolveProviderConfig: valores por defecto y timeout de inactividad", () => {
  const cfg = P.resolveProviderConfig({ provider: "anthropic", apiKeys: { anthropic: "k" }, model: "claude-haiku-4-5" });
  assert.equal(cfg.temperature, 0.4);
  assert.equal(cfg.maxTokens, 8192);
  assert.equal(cfg.timeoutMs, 180000); // 180s por defecto
});

test("resolveProviderConfig: timeoutSecs configurable -> ms", () => {
  const cfg = P.resolveProviderConfig({ provider: "anthropic", apiKeys: { anthropic: "k" }, model: "m", timeoutSecs: 300 });
  assert.equal(cfg.timeoutMs, 300000);
});

test("resolveProviderConfig: compat hacia atrás (apiKey suelta = google)", () => {
  const cfg = P.resolveProviderConfig({ provider: "google", apiKey: "AIzaXXX", model: "gemini-3.5-flash" });
  assert.equal(cfg.apiKey, "AIzaXXX");
});

test("resolveProviderConfig: google nunca fuerza jsonMode (no configurable)", () => {
  const cfg = P.resolveProviderConfig({ provider: "google", apiKeys: { google: "k" }, model: "gemma-4-31b-it", jsonMode: true });
  assert.equal(cfg.jsonMode, false);
});

test("resolveProviderConfig: sin modelo lanza (proveedor sin modelo por defecto)", () => {
  assert.throws(() => P.resolveProviderConfig({ provider: "custom", customBaseUrl: "http://x", model: "" }));
});

test("cada proveedor declara la API de streaming", () => {
  for (const id of Object.keys(P.PROVIDERS)) {
    const prov = P.PROVIDERS[id];
    assert.equal(typeof prov.streamEndpoint, "function", `${id}.streamEndpoint`);
    assert.equal(typeof prov.streamBody, "function", `${id}.streamBody`);
    assert.equal(typeof prov.streamDelta, "function", `${id}.streamDelta`);
  }
});

test("google streamEndpoint usa SSE", () => {
  const url = P.PROVIDERS.google.streamEndpoint("https://x/v1beta", "gemma-4-31b-it");
  assert.match(url, /streamGenerateContent\?alt=sse$/);
});
