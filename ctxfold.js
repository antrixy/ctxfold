#!/usr/bin/env node
"use strict";

// ctxfold CLI:
//   ctxfold [file]               compress stdin or file -> stdout
//   ctxfold --stats [file]       also print stats to stderr
//   ctxfold --dictionary [file]  opt-in: dictionary-code low-cardinality columns
//   ctxfold --decompress [file]  reverse a ctxfold payload
//   cat app.log | ctxfold --stats

const fs = require("fs");
const { compress, decompress } = require("../src/index");

function readInput(file) {
  if (file) return fs.readFileSync(file, "utf8");
  return fs.readFileSync(0, "utf8"); // stdin
}

function main() {
  const args = process.argv.slice(2);
  const stats = args.includes("--stats");
  const undo = args.includes("--decompress");
  const dictionary = args.includes("--dictionary");
  const file = args.find((a) => !a.startsWith("--"));
  const input = readInput(file);

  if (undo) {
    process.stdout.write(decompress(input));
    return;
  }

  const { text, stats: s } = compress(input, { dictionary });
  process.stdout.write(text);
  if (stats) {
    const pct = s.encoder === "none" ? 0 : (s.charRatio * 100).toFixed(1);
    process.stderr.write(
      `\n[ctxfold] encoder=${s.encoder}  lossless=${s.lossless}  ` +
      `chars ${s.charsBefore}->${s.charsAfter} (${pct}% smaller)\n`
    );
  }
}

main();
