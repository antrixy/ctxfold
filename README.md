# ctxfold

**Lossless, structure-aware re-encoding of bulky text to cut LLM prompt tokens.**

Logs, JSON arrays, and CSV are the highest-volume, most repetitive things people
put into LLM prompts. Semantic compressors shrink them by *summarizing* —
dropping "low-information" tokens and hoping. That quietly breaks any answer that
needed the dropped data (counts, totals, a specific record).

ctxfold takes the opposite approach. It re-encodes the **structure** — the
parts that repeat on every line/row — into a denser plain-text form the model
reads directly. Nothing is dropped. The single rule:

> **Lossless or no-op. Never lossy.**

Every encoder ships with a decoder, and `compress()` verifies that
decoding its output reproduces the input before returning it. If it can't, you
get your original text back, untouched. The tool cannot corrupt your data —
worst case, it does nothing.

## Why ctxfold

The usual way to cut prompt tokens is *semantic* compression — summarize the
input and drop "low-information" tokens. It works until the question needs the
data that got dropped. Ask *"how many errors are in this log?"* or *"what's the
total across these 400 rows?"* and a lossy compressor can hand back a confident,
wrong answer, because the rows it discarded were the ones you needed. The
compression looks great; the answer is broken.

ctxfold makes the opposite bet. Logs, JSON arrays, and CSV are tables in
disguise — the same keys, prefixes, and templates repeat on every line. ctxfold
lifts those repeated parts into a one-time header and keeps only what varies,
producing a compact, self-labeling table the model reads directly. It cuts
**~35–40% of tokens** on templated logs and JSON arrays, fully losslessly — and
because the output is plain, labeled text, the model reads it as well as the raw
input. In lookup tests against GPT-4o-mini, answers off the compressed form
matched answers off the raw data, field for field. (Readability is validated on
GPT-4o-mini; the lossless guarantee is model-independent.)

ctxfold isn't a replacement for semantic compression — it's the other half.
Summarize to extract a subset; ctxfold to shrink repetition without losing
anything. It shines on structured data, not prose.

## Install

```bash
npm install ctxfold
```

Zero runtime dependencies. Provider-agnostic — it operates on text, not on an API.

## Quick start

```js
const { compress } = require("ctxfold");

const { text, stats } = compress(bigBlob);
// Send `text` in your prompt instead of the original.
console.log(stats.encoder, `${(stats.tokenRatio * 100).toFixed(0)}% fewer tokens`, "lossless:", stats.lossless);
```

The model reads `text` directly — **there is no decode step at runtime.** The
decoder exists to *prove* losslessness (and is exposed as `decompress(text)` if
you ever want the data back programmatically).

For exact token stats, pass your tokenizer:

```js
const { encode } = require("gpt-tokenizer");
compress(bigBlob, { countTokens: (s) => encode(s).length });
```

## CLI

```bash
cat app.log | ctxfold --stats        # compress stdin -> stdout, stats to stderr
ctxfold data.json > packed.txt        # compress a file
ctxfold --decompress packed.txt       # reverse it
```

## What it handles

| Input | Detector | Typical token reduction |
|---|---|---|
| Templated logs (timestamp / level / `[scope]` / `key=value`) | newline-delimited, structured lines | ~35–40% |
| JSON array of flat objects — bare `[…]` or wrapped `{"results":[…]}` | top-level array, or an object with one records array | ~39% |
| CSV / TSV (simple, unquoted) | consistent delimiter + header + rows | ~30–45% *where columns share constants/affixes* |

Anything it doesn't recognize — prose, nested JSON, quoted CSV, an
already-tight table — passes through untouched.

## How it works

One shared primitive does most of the work: **per-column affix factoring**. If
every value in a column shares a prefix or suffix (`reqId=…`, `2026-06-…`,
`USR-…`, `[service]`), that repeated part is written **once** in a header and
each row keeps only what varies. Constant columns collapse to empty cells.
Repeated JSON keys and log templates are lifted into a one-time schema. The
result is a compact, self-labeling table with a `cols:` header the model reads
like a spreadsheet.

Rows that don't fit the dominant template are kept verbatim, so the transform is
always reversible.

## What "lossless" means

- **Logs, CSV/TSV:** byte-for-byte identical after round-trip.
- **JSON:** value-identical — the same data when parsed. (Whitespace and number
  formatting like `1.0` vs `1` are not data; key order is preserved.)

Either way, `compress()` checks the round-trip before returning, so you never get
a lossy result.

## Not a semantic compressor

ctxfold doesn't summarize and won't help with prose — for that, use semantic
compression (to extract a subset) or retrieval (to send only relevant chunks).
The two **compose**: summarize to pick what matters, then ctxfold to shrink the
repetition in what's left.

## Tests & benchmark

```bash
npm test                       # lossless round-trips across all three formats
npm i -D gpt-tokenizer         # optional, exact token counts
npm run bench [file]           # token reduction on logs (or your own file)
```

The `examples/` folder has GPT readability checks: they ask a model to read
records out of the compressed form and score against exact ground truth. In
testing, compressed read as accurately as raw (logs 23/24 vs 23/24, JSON 24/24
vs 24/24) at ~39% fewer tokens.

## Scope (v0)

- JSON objects are **flat** — records with nested objects/arrays are kept
  verbatim (nesting is a planned increment).
- CSV/TSV is **simple/unquoted** — quoted fields (commas/newlines inside cells)
  pass through, by design, to guarantee byte-exactness.

## Roadmap

- One level of JSON nesting
- Token profiler — show where a prompt's tokens go and what's compressible
- Optional dictionary coding for low-cardinality repeated values

## License

MIT — see [LICENSE](./LICENSE).
