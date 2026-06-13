// Tests del content script (extension/content.js): normalización de números y
// el dedup de react-select que evita escanear/registrar el mismo widget dos veces.
const test = require("node:test");
const assert = require("node:assert");
const { loadExtension } = require("./_load.js");

const C = loadExtension(["content.js"], ["toNumber", "isNestedDuplicate"]);

test("toNumber: extrae el entero inferior de un rango salarial", () => {
  assert.equal(C.toNumber("65.000–80.000 € brutos/año"), "65000");
  assert.equal(C.toNumber("55,000 to 65,000 USD"), "55000");
  assert.equal(C.toNumber("55000 a 65000"), "55000");
  assert.equal(C.toNumber("100k"), "100");
});

test("toNumber: devuelve null si no hay dígitos", () => {
  assert.equal(C.toNumber("Madrid, Spain"), null);
  assert.equal(C.toNumber(""), null);
});

// nodos DOM falsos con contains() basado en jerarquía
function node() {
  const n = { parent: null };
  n.contains = (o) => { if (o === n) return true; let p = o && o.parent; while (p) { if (p === n) return true; p = p.parent; } return false; };
  return n;
}
function child(parent) { const n = node(); n.parent = parent; return n; }

test("isNestedDuplicate: el input interno del mismo widget es duplicado", () => {
  const control = node();
  const combobox = child(control); // <input role=combobox> dentro de .select__control
  const seen = [];
  assert.equal(C.isNestedDuplicate(control, seen), false); seen.push(control);
  assert.equal(C.isNestedDuplicate(combobox, seen), true); // contenido por control -> dup
});

test("isNestedDuplicate: dos react-select separados NO son duplicados", () => {
  const a = node(), b = node();
  const seen = [];
  assert.equal(C.isNestedDuplicate(a, seen), false); seen.push(a);
  assert.equal(C.isNestedDuplicate(b, seen), false); seen.push(b);
});

test("isNestedDuplicate: simula el filtro de scan (control+combobox x2 -> 2 campos)", () => {
  const c1 = node(), cb1 = child(c1), c2 = node(), cb2 = child(c2);
  const seen = [];
  const kept = [c1, cb1, c2, cb2].filter((el) => {
    if (C.isNestedDuplicate(el, seen)) return false;
    seen.push(el);
    return true;
  });
  assert.deepEqual(kept, [c1, c2]); // un campo por widget
});
