"use strict";

// Readability proof for the CSV encoder: can the model read records out of the
// factored table as accurately as out of raw CSV? Exact ground truth, no
// counting. Self-contained (generates its own unquoted CSV with factorable
// redundancy: shared prefixes and constant columns).
//
//   cd ~/ctxfold && npm i openai
//   export OPENAI_API_KEY=sk-...
//   node examples/gpt-csv-equivalence.js
//
// The interesting part vs. the JSON test: folded CSV rows keep only each
// field's varying middle — the model must reconstitute full values through the
// legend's prefix/suffix rules (e.g. warehouse "CHI-1" -> "WH-CHI-1").

const OpenAI = require("openai");
const { compress } = require("../src/index");

const MODEL = process.env.MODEL || "gpt-4o-mini";
const N = 6;

function makeCsv(n = 400) {
  const cats = ["packaging", "equipment", "labels", "ppe", "electrical"];
  const whs = ["CHI-1", "DAL-2", "ATL-3", "SEA-4"];
  const sup = ["Acme", "Boruka", "VoltCo", "PrintZ"];
  const r = (m) => Math.floor(Math.random() * m);
  const rows = [];
  const recs = [];
  rows.push("sku,name,category,price,qty,warehouse,supplier,currency");
  for (let i = 0; i < n; i++) {
    const rec = {
      sku: `NW-${1000 + i}`,
      name: `Item ${i}`,
      category: cats[r(cats.length)],
      price: (Math.random() * 2500 + 5).toFixed(2),
      qty: String(r(10000)),
      warehouse: `WH-${whs[r(whs.length)]}`,
      supplier: sup[r(sup.length)],
      currency: "USD",
    };
    recs.push(rec);
    rows.push([rec.sku, rec.name, rec.category, rec.price, rec.qty, rec.warehouse, rec.supplier, rec.currency].join(","));
  }
  return { text: rows.join("\n") + "\n", recs };
}

async function lookup(client, dataText, primer, skus) {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 700,
    messages: [
      { role: "system", content: "You read structured product data and extract exact field values." },
      { role: "user", content:
        `${primer}For EACH of these SKUs: ${skus.join(", ")}\n` +
        `report price, qty, warehouse, supplier.\n` +
        `Return ONLY a JSON array of {"sku","price","qty","warehouse","supplier"}.\n\n${dataText}` },
    ],
  });
  const raw = res.choices[0].message.content.replace(/```json|```/g, "").trim();
  let arr = []; try { arr = JSON.parse(raw); } catch { /* empty */ }
  return { rows: arr, ptok: res.usage.prompt_tokens };
}

function score(answers, truth) {
  let correct = 0, total = 0; const misses = [];
  for (const a of answers) {
    const t = truth[String(a.sku)];
    if (!t) continue;
    for (const f of ["price", "qty", "warehouse", "supplier"]) {
      total++;
      if (String(a[f]).trim() === String(t[f]).trim()) correct++;
      else misses.push(`${a.sku}.${f}: got "${a[f]}" want "${t[f]}"`);
    }
  }
  return { correct, total, misses };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error("Set OPENAI_API_KEY"); process.exit(1); }
  const { text: rawText, recs } = makeCsv(400);
  const { text: packed, stats } = compress(rawText);
  if (stats.encoder !== "csv") { console.error(`expected csv encoder, got ${stats.encoder}`); process.exit(1); }

  const picks = [];
  const seen = new Set();
  while (picks.length < N) {
    const p = recs[Math.floor(Math.random() * recs.length)];
    if (seen.has(p.sku)) continue; seen.add(p.sku); picks.push(p);
  }
  const truth = Object.fromEntries(picks.map((p) => [p.sku, p]));
  const skus = picks.map((p) => p.sku);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const primer = "The data is a factored table: the 'legend:' line explains it. Rows keep only " +
    "each field's varying part; reconstruct full values using the legend's " +
    "prefix/suffix rules and report the FULL values.\n\n";

  const A = await lookup(client, rawText, "", skus);
  const B = await lookup(client, packed, primer, skus);
  const sa = score(A.rows, truth), sb = score(B.rows, truth);

  console.log(`\nmodel: ${MODEL}   records: ${skus.length}   encoder: ${stats.encoder}`);
  console.log(`chars ${stats.charsBefore}->${stats.charsAfter} (${(stats.charRatio * 100).toFixed(1)}% smaller)`);
  console.log(`prompt tokens   raw=${A.ptok}   compressed=${B.ptok}   (${(100 * (1 - B.ptok / A.ptok)).toFixed(1)}% fewer)`);
  console.log(`\nfield accuracy vs ground truth:`);
  console.log(`  RAW         ${sa.correct}/${sa.total}`);
  console.log(`  COMPRESSED  ${sb.correct}/${sb.total}`);
  if (sb.misses.length) { console.log(`\ncompressed misses:`); sb.misses.forEach((m) => console.log("  " + m)); }
  if (sa.misses.length) { console.log(`\nraw misses:`); sa.misses.forEach((m) => console.log("  " + m)); }
  console.log(`\nVERDICT: ${sb.correct >= sa.correct ? "compressed reads as well as (or better than) raw" : "compressed reads worse — adjust format"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
