"use strict";

// ctxfold — lossless, structure-aware re-encoding of bulky text for LLM
// prompts. One rule above all: LOSSLESS OR NO-OP. Every encoder ships a decoder,
// and compress() verifies decode(encode(x)) === x exactly before returning the
// compressed form. If the check fails, the original text is returned untouched.
// The model reads the compressed text directly — there is no decode step at
// runtime. The decoder exists only to PROVE the transform loses nothing.

const logs = require("./encoders/logs");
const json = require("./encoders/json");
const csv = require("./encoders/csv");

// Encoders are tried in priority order.
const ENCODERS = [json, csv, logs];

// Default losslessness check: exact byte match. Encoders may override with their
// own .verify(original, restored) — e.g. JSON compares parsed data, not bytes.
function verifyDefault(original, restored) {
  return original === restored;
}

// Cheap, dependency-free token estimate. For exact counts, pass opts.countTokens
// (e.g. a tiktoken/gpt-tokenizer function); the benchmark does this.
function estimateTokens(s) {
  return Math.ceil(s.length / 4);
}

function compress(text, opts = {}) {
  if (typeof text !== "string") throw new TypeError("compress(text): text must be a string");
  const count = opts.countTokens || estimateTokens;
  const only = opts.only ? new Set([].concat(opts.only)) : null;

  const base = {
    encoder: "none",
    lossless: true,
    charsBefore: text.length,
    charsAfter: text.length,
    tokensBefore: count(text),
    tokensAfter: count(text),
  };

  for (const enc of ENCODERS) {
    if (only && !only.has(enc.name)) continue;
    let result;
    try {
      if (!enc.detect(text)) continue;
      result = enc.encode(text);
    } catch {
      continue;
    }
    if (!result || !result.ok) continue;

    // The safety net: must reproduce the input (per the encoder's own
    // definition of lossless), or we don't use it.
    let restored;
    try {
      restored = enc.decode(result.encoded);
    } catch {
      continue;
    }
    const verify = enc.verify || verifyDefault;
    if (!verify(text, restored)) continue;

    // Must actually save something, or it's not worth the legend overhead.
    if (result.encoded.length >= text.length) continue;

    return {
      text: result.encoded,
      stats: {
        encoder: enc.name,
        lossless: true,
        charsBefore: text.length,
        charsAfter: result.encoded.length,
        charRatio: 1 - result.encoded.length / text.length,
        tokensBefore: count(text),
        tokensAfter: count(result.encoded),
        tokenRatio: 1 - count(result.encoded) / count(text),
      },
    };
  }

  return { text, stats: base };
}

// Round-trip a compressed string back to the original (for verification or for
// any caller that wants the data back programmatically).
function decompress(encoded) {
  for (const enc of ENCODERS) {
    try {
      if (encoded.startsWith("\u27e6cf/" + enc.name)) return enc.decode(encoded);
    } catch {
      /* try next */
    }
  }
  return encoded; // not a ctxfold payload; return as-is
}

module.exports = { compress, decompress, estimateTokens, ENCODERS };
