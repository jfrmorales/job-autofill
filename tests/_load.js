// Carga los scripts "clásicos" de la extensión (sin export, pensados para
// <script>/importScripts) dentro de un contexto vm, y devuelve los símbolos
// pedidos. Concatena los archivos en un solo script para que los `const` de
// nivel superior (p.ej. PROVIDERS) se compartan entre ellos, igual que hace
// importScripts en el service worker.
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const EXT = path.join(__dirname, "..", "extension");

function loadExtension(files, expose, sandbox = {}) {
  const ctx = vm.createContext({
    console,
    navigator: { language: "en" },
    TextDecoder, TextEncoder, AbortController, ReadableStream,
    setTimeout, clearTimeout, Event,
    importScripts: () => {},
    chrome: {
      runtime: { onMessage: { addListener: () => {} } },
      storage: { local: { get: async () => ({}) } },
      action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
    },
    ...sandbox,
  });
  // fetch se delega a una variable que los tests pueden reasignar.
  ctx.fetch = (...args) => ctx.__fetch(...args);
  const code = files.map((f) => fs.readFileSync(path.join(EXT, f), "utf8")).join("\n;\n")
    + `\n;this.__exports = { ${expose.join(", ")} };`;
  vm.runInContext(code, ctx, { filename: files.join("+") });
  ctx.__exports.__ctx = ctx; // para inyectar __fetch desde el test
  return ctx.__exports;
}

// Construye una Response simulada de streaming SSE. `chunks` son las cadenas de
// texto que el "servidor" emite. Si `stall` es true, tras emitir los chunks la
// lectura NO resuelve hasta que se aborta la señal (simula modelo colgado).
function sseResponse(chunks, { status = 200, stall = false } = {}) {
  return (url, opts) => {
    const signal = opts && opts.signal;
    let i = 0;
    const enc = new TextEncoder();
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: async () => "error body",
      body: {
        getReader() {
          return {
            read() {
              if (i < chunks.length) {
                return Promise.resolve({ value: enc.encode(chunks[i++]), done: false });
              }
              if (stall) {
                // nunca resuelve; solo rechaza con AbortError cuando se aborta
                return new Promise((_, reject) => {
                  signal.addEventListener("abort", () => {
                    const e = new Error("aborted");
                    e.name = "AbortError";
                    reject(e);
                  });
                });
              }
              return Promise.resolve({ done: true });
            },
            cancel() {},
          };
        },
      },
    });
  };
}

module.exports = { loadExtension, sseResponse };
