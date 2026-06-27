"use strict";

// JSON-array encoder (flat). Detects a top-level JSON array of objects with
// scalar values, and re-encodes as a clean column table: keys + per-column type
// declared ONCE in the header, then one tab-separated row of bare values per
// object. Objects that don't fit the modal schema (or have nested values) are
// kept verbatim. Reversible; losslessness is value-level (see verify()).

function scalarKind(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return t;
  return "complex"; // object/array — flat encoder won't factor these
}

function detect(text) {
  const t = text.trim();
  if (t.length <= 200 || !/\[\s*\{/.test(t)) return false;
  return t[0] === "[" || t[0] === "{"; // bare array OR object wrapping an array
}

// From a parsed top-level value, find the records array to encode.
// Returns { arr, wrap } where wrap is null for a bare array, or
// { order, arrayKey, rest } for an object wrapping exactly one records array.
function extractArray(parsed) {
  if (Array.isArray(parsed)) return { arr: parsed, wrap: null };
  if (!parsed || typeof parsed !== "object") return null;

  const order = Object.keys(parsed);
  const arrayKeys = order.filter((k) => {
    const v = parsed[k];
    if (!Array.isArray(v) || v.length < 4) return false;
    const objs = v.filter((e) => e && typeof e === "object" && !Array.isArray(e)).length;
    return objs >= v.length * 0.6;
  });
  if (arrayKeys.length !== 1) return null; // 0 or ambiguous -> decline

  const arrayKey = arrayKeys[0];
  const rest = {};
  for (const k of order) if (k !== arrayKey) rest[k] = parsed[k];
  return { arr: parsed[arrayKey], wrap: { order, arrayKey, rest } };
}

// Per-cell tagged encoding, used only for "mixed"-type columns.
function encodeCell(v) {
  switch (scalarKind(v)) {
    case "string": return "s" + JSON.stringify(v);
    case "number": return "n" + String(v);
    case "boolean": return v ? "b1" : "b0";
    case "null": return "z";
    default: return null;
  }
}
function decodeCell(cell) {
  const tag = cell[0], body = cell.slice(1);
  if (tag === "s") return JSON.parse(body);
  if (tag === "n") return Number(body);
  if (tag === "b") return body === "1";
  if (tag === "z") return null;
  throw new Error("bad cell tag");
}

// Decide a column's encoding type from its values.
function columnType(values) {
  const kinds = new Set(values.map(scalarKind));
  if (kinds.size === 1) {
    const only = kinds.values().next().value;
    if (only === "string") {
      // Bare strings are only safe if they contain no tab/newline (our delims).
      if (values.every((v) => v.indexOf("\t") === -1 && v.indexOf("\n") === -1)) return "s";
      return "mixed";
    }
    if (only === "number") return "n";
    if (only === "boolean") return "b";
    if (only === "null") return "z";
  }
  return "mixed";
}

function encodeByType(v, t) {
  switch (t) {
    case "s": return v;
    case "n": return String(v);
    case "b": return v ? "1" : "0";
    case "z": return "";
    default: return encodeCell(v);
  }
}
function decodeByType(cell, t) {
  switch (t) {
    case "s": return cell;
    case "n": return Number(cell);
    case "b": return cell === "1";
    case "z": return null;
    default: return decodeCell(cell);
  }
}

function encode(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false }; }
  const extracted = extractArray(parsed);
  if (!extracted) return { ok: false };
  const { arr, wrap } = extracted;
  if (!Array.isArray(arr) || arr.length < 4) return { ok: false };

  // Modal key signature among flat objects.
  const sigCount = new Map(), sigKeys = new Map();
  for (const obj of arr) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
    const keys = Object.keys(obj);
    if (!keys.every((k) => scalarKind(obj[k]) !== "complex")) continue;
    const sig = JSON.stringify(keys);
    sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
    if (!sigKeys.has(sig)) sigKeys.set(sig, keys);
  }
  if (sigCount.size === 0) return { ok: false };
  let bestSig = null, bestN = -1;
  for (const [sig, n] of sigCount) if (n > bestN) { bestSig = sig; bestN = n; }
  if (bestN < 4) return { ok: false };
  const keys = sigKeys.get(bestSig);

  // Partition conforming objects vs verbatim (by index).
  const conforming = [];
  const verbatim = {};
  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i];
    let ok = false;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const k = Object.keys(obj);
      ok = JSON.stringify(k) === bestSig && k.every((kk) => scalarKind(obj[kk]) !== "complex");
    }
    if (ok) conforming.push(i);
    else verbatim[i] = JSON.stringify(obj);
  }
  if (conforming.length < 4) return { ok: false };

  // Per-column type from the conforming objects.
  const types = keys.map((k) => columnType(conforming.map((i) => arr[i][k])));

  const rows = conforming.map((i) =>
    keys.map((k, c) => encodeByType(arr[i][k], types[c])).join("\t")
  );

  const spec = { v: 1, n: arr.length, cols: keys.map((k, c) => ({ k, t: types[c] })), verbatim, wrap };

  const wrapNote = wrap
    ? `a JSON object with keys [${wrap.order.join(", ")}], where "${wrap.arrayKey}" is the array below`
    : `a JSON array`;
  const legend =
    `legend: ${wrapNote} of ${arr.length} objects as a table. Columns: ` +
    `${keys.join(", ")}. Each row is tab-separated values in that order, in array order. ` +
    `Values are bare (a column's type is fixed); rows reconstruct the original objects.`;

  const out =
    "\u27e6cf/json v1\u27e7\n" +
    "spec " + JSON.stringify(spec) + "\n" +
    legend + "\n" +
    "cols: " + keys.join("\t") + "\n" +
    "rows:\n" +
    rows.join("\n");

  return { ok: true, encoded: out };
}

function decode(encoded) {
  const nl = encoded.indexOf("\n");
  if (encoded.slice(0, nl) !== "\u27e6cf/json v1\u27e7") throw new Error("bad magic");
  let rest = encoded.slice(nl + 1);

  const specEnd = rest.indexOf("\n");
  const spec = JSON.parse(rest.slice("spec ".length, specEnd));
  rest = rest.slice(specEnd + 1);

  const marker = "\nrows:\n";
  const rowsBlock = rest.slice(rest.indexOf(marker) + marker.length);
  const rowLines = rowsBlock.length ? rowsBlock.split("\n") : [];

  const { n, cols, verbatim, wrap } = spec;
  const out = new Array(n);
  let rp = 0;
  for (let i = 0; i < n; i++) {
    if (Object.prototype.hasOwnProperty.call(verbatim, i)) {
      out[i] = JSON.parse(verbatim[i]);
      continue;
    }
    const cells = rowLines[rp++].split("\t");
    const obj = {};
    for (let c = 0; c < cols.length; c++) obj[cols[c].k] = decodeByType(cells[c], cols[c].t);
    out[i] = obj;
  }

  if (wrap) {
    const result = {};
    for (const k of wrap.order) result[k] = k === wrap.arrayKey ? out : wrap.rest[k];
    return JSON.stringify(result);
  }
  return JSON.stringify(out);
}

// Value-level losslessness: decode reproduces the same DATA when parsed.
function verify(original, restored) {
  try { return JSON.stringify(JSON.parse(original)) === restored; }
  catch { return false; }
}

module.exports = { name: "json", detect, encode, decode, verify };
