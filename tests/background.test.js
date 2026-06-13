// Tests del service worker (extension/background.js): el bucle de streaming SSE
// de callProvider (incluido el timeout de INACTIVIDAD), el failover y el prompt.
const test = require("node:test");
const assert = require("node:assert");
const { loadExtension, sseResponse } = require("./_load.js");

const X = loadExtension(
  ["i18n.js", "providers.js", "background.js"],
  ["callProvider", "streamReason", "isFailover", "buildPrompt", "parseJsonObject",
   "PROVIDERS", "setLang", "getLang"]
);

function cfg(provider = "openai", timeoutMs = 5000) {
  return {
    P: X.PROVIDERS[provider], model: "m", baseUrl: "http://x/v1", apiKey: "k",
    temperature: 0.4, maxTokens: 100, jsonMode: false, timeoutMs,
  };
}
const openaiSSE = (txt) => txt.split("").length && `data: {"choices":[{"delta":{"content":${JSON.stringify(txt)}}}]}\n\n`;

test("callProvider: acumula el texto del stream token a token", async () => {
  X.__ctx.__fetch = sseResponse([openaiSSE("Hola"), openaiSSE(" mundo"), "data: [DONE]\n\n"]);
  const out = await X.callProvider(cfg(), "hola");
  assert.equal(out, "Hola mundo");
});

test("callProvider: tolera líneas SSE partidas entre chunks", async () => {
  const full = openaiSSE("Hola mundo");
  X.__ctx.__fetch = sseResponse([full.slice(0, 10), full.slice(10), "data: [DONE]\n\n"]);
  const out = await X.callProvider(cfg(), "hola");
  assert.equal(out, "Hola mundo");
});

test("callProvider: timeout de INACTIVIDAD marca el error como failover-elegible", async () => {
  X.__ctx.__fetch = sseResponse([openaiSSE("Ho")], { stall: true });
  await assert.rejects(
    X.callProvider(cfg("openai", 120), "hola"),
    (err) => { assert.equal(err.timeout, true); assert.equal(X.isFailover(err), true); return true; }
  );
});

test("callProvider: error HTTP propaga status y es failover-elegible", async () => {
  X.__ctx.__fetch = sseResponse([], { status: 500 });
  await assert.rejects(
    X.callProvider(cfg(), "hola"),
    (err) => { assert.equal(err.status, 500); assert.equal(X.isFailover(err), true); return true; }
  );
});

test("isFailover: 429/5xx/timeout sí, 4xx y errores sin marca no", () => {
  assert.equal(X.isFailover({ timeout: true }), true);
  assert.equal(X.isFailover({ status: 429 }), true);
  assert.equal(X.isFailover({ status: 503 }), true);
  assert.equal(X.isFailover({ status: 400 }), false);
  assert.equal(X.isFailover({}), false);
  assert.equal(X.isFailover(null), null); // operador && cortocircuita
});

test("streamReason: detecta el motivo de cierre de cada proveedor", () => {
  assert.equal(X.streamReason({ choices: [{ finish_reason: "length" }] }), "length");
  assert.equal(X.streamReason({ candidates: [{ finishReason: "MAX_TOKENS" }] }), "MAX_TOKENS");
  assert.equal(X.streamReason({ promptFeedback: { blockReason: "SAFETY" } }), "SAFETY");
  assert.equal(X.streamReason({ delta: { stop_reason: "end_turn" } }), "end_turn");
  assert.equal(X.streamReason({}), "");
});

test("parseJsonObject: quita vallas markdown y recorta al objeto", () => {
  assert.deepEqual(X.parseJsonObject('```json\n{"0":"a"}\n```', "tag"), { "0": "a" });
  assert.throws(() => X.parseJsonObject("sin json", "tag"));
});

test("buildPrompt: prohíbe explícitamente respuestas 'n/a' (EN y ES)", () => {
  const fields = [{ index: 0, type: "text", label: "Tell us about X", required: false }];
  X.setLang("en");
  assert.match(X.buildPrompt({}, "cv", "page", fields), /never write "n\/a"/);
  X.setLang("es");
  assert.match(X.buildPrompt({}, "cv", "page", fields), /nunca pongas "n\/a"/);
});
