# Proof-tree visualizer

A Lean 4 proof rendered as an interactive tree. Two halves, one repo:

```
diss/
├── lean/                 # ppharness — Lean CLI wrapping Paperproof's BetterParser.
│   ├── Main.lean         #   CLI: emits one NDJSON line per proof.
│   ├── Ppharness.lean    #   library: source text → parsed proof.
│   └── lakefile.toml     #   deps: Paperproof (parser) + Mathlib (parse-time env).
├── proofs/               # Lean source(s) to visualize.
│   └── sample.lean
├── web/                  # React + d3-dag renderer (Vite).
│   └── src/
│       ├── paperproof.ts #   TS mirror of the NDJSON wire format.
│       ├── proofToTree.ts#   adapter: parsed proof → render tree (the glue).
│       ├── layout.ts     #   Sugiyama layout engine.
│       └── App.tsx        #   renderer + proof picker.
└── gen.sh                # parse proofs/ → web/public/sample.ndjson.
```

## Pipeline

```
proofs/*.lean ──ppharness (lean)──▶ NDJSON ──proofToTree (web)──▶ d3-dag tree
```

`ppharness` runs the parser in an environment where **Mathlib is on `LEAN_PATH`**
(via `lake env`), so real `import Mathlib` proofs elaborate. The web app reads the
emitted NDJSON; a picker selects which proof to render. Each tactic becomes an
edge node (`goalBefore → goalsAfter`), each goal a box; hypotheses introduced by
a step are drawn on its edge.

## Use

```bash
# 1. one-time Lean setup (downloads Mathlib oleans from cache):
cd lean && lake exe cache get && lake build && cd ..

# 2. parse the proofs into the web app's data file:
./gen.sh

# 3. run the visualizer:
cd web && npm install && npm run dev
```

Edit `proofs/` (or add files), re-run `./gen.sh`, reload the page.

## Toolchain note

Pinned to **Lean v4.27.0** for both the parser and Mathlib. Paperproof's harness
here elaborates a file to completion with `IO.processCommands` and reads
`infoState.trees`; on v4.29+ tactic subtrees elaborate asynchronously and are not
attached, yielding empty proofs. v4.27.0 keeps tactic elaboration synchronous.

## Production direction

For the eventual Lean **user-widget**, there is no CLI and no NDJSON: the React
bundle embeds in the infoview and calls `BetterParser` in-process over RPC, inside
the user's own Lean server where Mathlib is already loaded. The CLI/NDJSON path
here is the development harness. `proofToTree` and the renderer are unchanged by
that switch — only the data source moves (see `SAMPLE_URL` in `App.tsx`).
