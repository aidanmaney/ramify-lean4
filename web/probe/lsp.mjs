// The LIVE-SERVER probe: drive the real Lean language server the way
// vscode-lean4 does and call the widget's own RPC, so widget-only data
// (diagnostics, taggedGoals, tokenInfos, counterfactual, openBlock) and the
// live-server timing can be measured instead of guessed at from the CLI —
// three bugs in one day were invisible to every offline probe and fell to this.
//
//   npm run probe -- lsp <file.lean> <line> <col> [--json] [--cf=0] [--all]
//                                        [--trace] [--rewrite] [--collapse]
//                                        [--rename] [--direct] [--lint]
//                                        [--edits]
//
// `--lint` is D4's live gate: it calls `ProofTree.lintDecl` (one re-elaboration
// of the declaration with Mathlib's own linters on), prints every lint with
// the node `lintNodeAt` puts it on, and runs each `lintFix` through
// `ProofTree.checkRewrite`, so an offered fix is re-elaborated for real.  It
// fetches B4's traces first where a `linter.flexible` lint is present, because
// that lint's fix IS D2b's expand.
//
// `--edits` is the TIGHT-RANGE invariant: every `tacticEdits` entry that
// starts a `deleteSlots` slot must reach that slot's own stop (or stop where
// the slot goes on to open a block or a `<;>` combinator), and its `text` must
// be the file's own bytes at the range it claims.  It works with `--all`.
//
// `--rename` is D5's live gate: it computes every hypothesis rename the tree's
// own context lines offer (`renamesFor`, from the payload's `haveUses` and its
// `tacticEdits`) and runs each through `ProofTree.checkRewrite`, so an offered
// rename is re-elaborated for real before it is believed.  `--direct` is D3's:
// it prints the contradiction-shape analysis for the declaration and asks the
// elaborator about the one redirection the module offers.
//
// `--collapse` is D2's live gate: it finds every LINEAR RUN in the payload's
// own tree (`linearRuns`, the same pure function the widget offers from) and
// calls `ProofTree.tryClose` on each closing one, printing which candidate
// won and what every candidate cost.  With `--expand` it also fetches the
// automation traces (B4) and runs each step's `simp` → `simp only [\u2026]`
// replacement through `checkRewrite`, so the verbatim-suggestion rule is
// exercised against the elaborator rather than against the corpus.
//
// `--rewrite` is D1's live gate: it builds the tree from the payload the
// server just returned, computes both restructuring proposals from the
// payload's OWN `tacticEdits` (the same verbatim source the widget reads),
// and calls `ProofTree.checkRewrite` on each — so an offered rewrite is
// re-elaborated for real.  It also checks one DELIBERATELY broken variant of
// the first offered inline (the `have` deleted with nothing put in its place,
// which is what inlining into a context-reading tactic like `omega` would
// amount to) so the reject side of the classifier is exercised too.
//
// `--trace` also calls `ProofTree.getAutomationTrace` at that position (B4)
// and prints one row per automation step in the declaration: the tactic, the
// kind (`lemmas` / `opaque` / `failed`) and the lemmas core's own `?` form
// reported.  It is the only gate on that RPC — the CLI's `--traces` runs a
// different elaboration path.
//
// line/col are 0-based LSP coordinates.  Prints a summary (steps, proofId,
// declRange, diagnostics, openBlock, cf fields, timings); --json dumps the
// payload; --all walks every `theorem` in the file at its `by` and prints one
// row per proof (the "one pass through the file" timing).
//
// Recipe (each step was load-bearing when it was found): `lake serve` from
// lean/ (the package that owns the file); initialize with
// initializationOptions.hasWidgets = true (without it MsgEmbed text is empty);
// didOpen; wait for `$/lean/fileProgress` with an EMPTY `processing` list;
// `$/lean/rpc/connect` for a sessionId; `$/lean/rpc/call` with
// {textDocument, position, sessionId, method, params}.  Messages come from
// `d.toDiagnostic.message`, never `stripTags`.
import { spawn } from "node:child_process";
import {
  proofToTree,
  inlineRewrite,
  extractRewrite,
  linearRuns,
  hasSlot,
  collapseRewrite,
  expandRewrite,
  applyTraces,
  traceIndex,
  AUTOMATION_CANDIDATES,
  renamesFor,
  contradictionShapes,
  lintsByNode,
  lintFix,
  lintName,
} from "./lib.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")).map(([k, v]) => [k, v ?? "1"]));
const [file, lineS, colS] = args.filter((a) => !a.startsWith("--"));
if (!file) { console.log("usage: npm run probe -- lsp <file.lean> <line> <col> [--json] [--cf=0] [--all]"); process.exit(1); }
const abs = path.resolve(file);
const leanDir = abs.includes("/lean/") ? abs.slice(0, abs.indexOf("/lean/") + 5) : path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../lean");
const uri = pathToFileURL(abs).href;
const text = fs.readFileSync(abs, "utf8");

const proc = spawn("lake", ["serve", "--"], { cwd: leanDir, stdio: ["pipe", "pipe", "inherit"] });
let buf = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();
const notes = [];
const waiters = [];
proc.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  for (;;) {
    const m = /^Content-Length: (\d+)\r\n\r\n/.exec(buf.toString("latin1", 0, Math.min(buf.length, 64)));
    if (!m) break;
    const len = Number(m[1]);
    const start = m[0].length;
    if (buf.length < start + len) break;
    const msg = JSON.parse(buf.toString("utf8", start, start + len));
    buf = buf.subarray(start + len);
    if (!msg.method && msg.id !== undefined && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
    else if (msg.method) { notes.push(msg); for (const w of [...waiters]) if (w(msg)) waiters.splice(waiters.indexOf(w), 1); }
  }
});
const send = (obj) => { const s = JSON.stringify(obj); proc.stdin.write(`Content-Length: ${Buffer.byteLength(s)}\r\n\r\n${s}`); };
const request = (method, params) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); send({ jsonrpc: "2.0", id, method, params }); });
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
const waitFor = (pred) => new Promise((res) => { const hit = notes.find(pred); if (hit) return res(hit); waiters.push((m) => pred(m) && (res(m), true)); });

const t0 = Date.now();
await request("initialize", { processId: process.pid, rootUri: pathToFileURL(leanDir).href, capabilities: {}, initializationOptions: { hasWidgets: true } });
notify("initialized", {});
notify("textDocument/didOpen", { textDocument: { uri, languageId: "lean4", version: 1, text } });
await waitFor((m) => m.method === "$/lean/fileProgress" && m.params.textDocument.uri === uri && m.params.processing.length === 0);
const tElab = Date.now() - t0;
const { sessionId } = await request("$/lean/rpc/connect", { uri });

async function call(line, character) {
  const t = Date.now();
  const r = await request("$/lean/rpc/call", { textDocument: { uri }, position: { line, character }, sessionId, method: "ProofTree.getProofTree", params: { pos: { uri, line, character }, cf: flags.cf !== "0" } });
  return { ms: Date.now() - t, r };
}
const row = (line, character, { ms, r }) => ({
  at: `${line}:${character}`, ms, proofId: r.proofId ?? "", steps: r.steps?.length ?? 0, goals: r.allGoals?.length ?? 0,
  declRange: r.declRange ? `${r.declRange.start.line}-${r.declRange.stop.line}` : null,
  diagnostics: r.diagnostics?.length ?? 0, errors: r.diagnostics?.filter((d) => d.severity === 1).length ?? 0,
  openBlock: !!r.openBlock, cf: r.cfLine !== undefined ? `line ${r.cfLine} draft=${JSON.stringify(r.cfDraft ?? "")}` : null, cfPending: !!r.cfPending,
  tagged: r.taggedGoals?.length ?? 0, tokens: r.tokenInfos?.length ?? 0, tacticEdits: r.tacticEdits?.length ?? 0, slots: r.deleteSlots?.length ?? 0,
});

// `--edits` is the TIGHT-RANGE invariant (2026-09-09): every `tacticEdits`
// entry that starts a `deleteSlots` slot must reach that slot's own tight
// stop, and its `text` must be the file's bytes at the range it claims.  A
// macro that expands to nested tactics (`intro h h2` → `intro h; intro h2`)
// used to hand the edit the INNER node's range, so the entry stopped at the
// first binder while the slot correctly reached the last.
const docLines = text.split("\n");
const sliceOf = (a, b) => {
  if (a.line === b.line) return docLines[a.line].slice(a.character, b.character);
  const out = [docLines[a.line].slice(a.character)];
  for (let i = a.line + 1; i < b.line; i++) out.push(docLines[i]);
  out.push(docLines[b.line].slice(0, b.character));
  return out.join("\n");
};
const editRows = (r) => {
  const slotAt = new Map(
    (r.deleteSlots ?? []).map((s) => [`${s.start.line}:${s.start.character}`, s]),
  );
  const rows = [];
  for (const e of r.tacticEdits ?? []) {
    const k = `${e.start.line}:${e.start.character}`;
    const s = slotAt.get(k);
    const verbatim = sliceOf(e.start, e.stop) === e.text;
    // A slot that runs on past the edit is only a FINDING when what it adds is
    // more of the same tactic.  `induction … with` opens a block the slot owns
    // and the step does not, and `rcases … <;> exact h` is a combinator whose
    // step is the left operand: in both the remainder begins at a line break
    // or a `<;>`, and the edit is right to stop where it does.
    const slotStop = s ? `${s.stop.line}:${s.stop.character}` : "";
    const rest = s ? sliceOf(e.stop, s.stop) : "";
    const opens = /^(\s*\n|\s*<;>|\s*;)/.test(rest);
    rows.push({
      at: k, stop: `${e.stop.line}:${e.stop.character}`, slotStop,
      reaches: s ? (rest === "" ? "yes" : opens ? "opens" : "SHORT") : "—",
      verbatim: verbatim ? "yes" : "NO",
      text: e.text.split("\n")[0].slice(0, 34),
      slotText: s ? sliceOf(s.start, s.stop).split("\n")[0].slice(0, 34) : "",
    });
  }
  return rows;
};

console.error(`elaborated ${path.basename(abs)} in ${tElab}ms`);
if (flags.all) {
  const lines = text.split("\n");
  const rows = [];
  const allEdits = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(theorem|lemma|example)\b.*:=\s*by\s*$/.exec(lines[i]) ?? (/^(theorem|lemma|example)\b/.test(lines[i]) ? { index: 0 } : null);
    if (!m) continue;
    // the `by` line: the first line at or after the head ending in `:= by`
    let j = i; while (j < lines.length && !/:=\s*by\s*(--.*)?$/.test(lines[j])) j++;
    if (j >= lines.length) continue;
    const res = await call(j + 1, 2);
    rows.push(row(j + 1, 2, res));
    if (flags.edits) allEdits.push(...editRows(res.r).map((e) => ({ decl: lines[i].split(" ")[1] ?? "", ...e })));
    i = j;
  }
  console.table(rows);
  if (flags.edits) {
    const bad = allEdits.filter((e) => e.reaches === "SHORT" || e.verbatim === "NO");
    console.log(`\n${allEdits.length} tacticEdits entries, ${bad.length} short of or off their slot`);
    console.table(bad.length ? bad : allEdits);
  }
} else {
  const line = Number(lineS ?? 0), col = Number(colS ?? 0);
  const res = await call(line, col);
  if (flags.json) console.log(JSON.stringify(res.r, null, 2));
  else console.log(row(line, col, res));
  // The counterfactual answers on a LATER call: the first one arms it and
  // returns `cfPending`.  Poll for the served payload so a cf regression is
  // visible from this probe rather than only in the editor.
  if (res.r.cfPending) {
    for (let k = 0; k < 8; k++) {
      await new Promise((r) => setTimeout(r, 500));
      const again = await call(line, col);
      if (again.r.cfLine != null || !again.r.cfPending) { console.log("after cf:", row(line, col, again)); break; }
    }
  }
  if (flags.lint) {
    // D4's live gate: one re-elaboration of the declaration with Mathlib's
    // linters on, every lint printed with the node it lands on.
    const t0 = Date.now();
    const lr = await request("$/lean/rpc/call", {
      textDocument: { uri }, position: { line, character: col }, sessionId,
      method: "ProofTree.lintDecl", params: { pos: { uri, line, character: col } },
    });
    const t1 = Date.now();
    await request("$/lean/rpc/call", {
      textDocument: { uri }, position: { line, character: col }, sessionId,
      method: "ProofTree.lintDecl", params: { pos: { uri, line, character: col } },
    });
    console.log(`\nlintDecl in ${t1 - t0}ms (cached call ${Date.now() - t1}ms)${lr.note ? ` — ${lr.note}` : ""}`);
    const payload = res.r;
    let nodes = proofToTree(payload, { slots: payload.deleteSlots });
    const slots = payload.deleteSlots ?? [];
    // `linter.flexible`'s fix IS D2b's expand, so it needs B4's traces; the
    // widget fetches them on the click for exactly the same reason.
    if ((lr.lints ?? []).some((l) => l.linter === "linter.flexible")) {
      const tr = await request("$/lean/rpc/call", {
        textDocument: { uri }, position: { line, character: col }, sessionId,
        method: "ProofTree.getAutomationTrace", params: { pos: { uri, line, character: col } },
      });
      nodes = applyTraces(nodes, new Set(), traceIndex(tr.traces ?? []));
    }
    const byNode = lintsByNode(nodes, lr.lints ?? []);
    const owner = new Map();
    for (const [id, ls] of byNode) for (const l of ls) owner.set(l, id);
    const byStart = new Map(
      (payload.tacticEdits ?? []).map((e) => [
        `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`, e,
      ]),
    );
    const ctx = {
      nodes, slots,
      src: (p) => {
        const e = byStart.get(`${p.line}:${p.character}`);
        return e ? { start: e.start, stop: e.stop, text: e.text, indent: e.tacticIndent ?? e.start.character } : null;
      },
    };
    const rows = [];
    for (const l of lr.lints ?? []) {
      const id = owner.get(l) ?? null;
      const n = id ? nodes.find((x) => x.id === id) : null;
      const p = lintFix(l, n ?? null, ctx);
      const base = {
        at: `${l.start.line}:${l.start.character}-${l.stop.line}:${l.stop.character}`,
        linter: lintName(l),
        node: n ? n.label.split("\n")[0].slice(0, 24) : "—",
        message: l.message.replace(/\n/g, " ").slice(0, 46),
      };
      if (!p.ok) { rows.push({ ...base, fix: "no", why: p.why.slice(0, 40) }); continue; }
      const t = Date.now();
      const v = await request("$/lean/rpc/call", {
        textDocument: { uri }, position: { line, character: col }, sessionId,
        method: "ProofTree.checkRewrite",
        params: { pos: { uri, line, character: col }, edits: p.rewrite.edits.map((e) => ({ start: e.range.start, stop: e.range.end, newText: e.newText })) },
      });
      rows.push({
        ...base, fix: p.rewrite.title.slice(0, 34),
        edit: p.rewrite.edits.map((e) => `${e.range.start.line}:${e.range.start.character}-${e.range.end.line}:${e.range.end.character}→${JSON.stringify(e.newText)}`).join(" "),
        verdict: v.verdict, ms: Date.now() - t, why: (v.message ?? "").slice(0, 32),
      });
    }
    console.table(rows);
  }
  if (flags.edits) {
    const rows = editRows(res.r);
    const bad = rows.filter((e) => e.reaches === "SHORT" || e.verbatim === "NO");
    console.log(`\n${rows.length} tacticEdits entries, ${bad.length} short of or off their slot`);
    console.table(rows);
  }
  if (flags.rewrite) {
    const payload = res.r;
    const nodes = proofToTree(payload, { slots: payload.deleteSlots });
    const byStart = new Map(
      (payload.tacticEdits ?? []).map((e) => [
        `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`,
        e,
      ]),
    );
    const ctx = {
      nodes,
      slots: payload.deleteSlots ?? [],
      src: (p) => {
        const e = byStart.get(`${p.line}:${p.character}`);
        return e
          ? { start: e.start, stop: e.stop, text: e.text, indent: e.tacticIndent ?? e.start.character }
          : null;
      },
    };
    const check = async (edits) => {
      const t = Date.now();
      const r = await request("$/lean/rpc/call", {
        textDocument: { uri }, position: { line, character: col }, sessionId,
        method: "ProofTree.checkRewrite",
        params: { pos: { uri, line, character: col }, edits: edits.map((e) => ({ start: e.range.start, stop: e.range.end, newText: e.newText })) },
      });
      return { ...r, ms: Date.now() - t };
    };
    const rows = [];
    let firstInline = null;
    for (const n of nodes) {
      if (n.type !== "tactic" || !n.position) continue;
      for (const [kind, f] of [["inline", inlineRewrite], ["extract", extractRewrite]]) {
        if (kind === "inline" && !n.uses) continue;
        const p = f(n, ctx);
        if (!p.ok) { rows.push({ at: `${n.position.start.line}:${n.position.start.character}`, kind, offered: "no", why: p.why.slice(0, 64) }); continue; }
        firstInline ??= kind === "inline" ? p.rewrite : null;
        const v = await check(p.rewrite.edits);
        rows.push({
          at: `${n.position.start.line}:${n.position.start.character}`, kind, offered: p.rewrite.title.slice(0, 40),
          verdict: v.verdict, steps: `${v.before}→${v.steps}`, ms: v.ms, msg: (v.message ?? "").slice(0, 48),
        });
      }
    }
    console.table(rows);
    if (firstInline) {
      // The reject side: the `have` removed and NOTHING put where it was used
      // — what inlining into a tactic that reads the context (`omega`) would
      // come to, and the reason `rewrite.ts` refuses to offer it.
      const v = await check([firstInline.edits.find((e) => e.newText === "")]);
      console.log(`deleted \`${firstInline.name}\` without substituting → ${v.verdict}: ${v.message}`);
    }
  }
  if (flags.rename || flags.direct) {
    const payload = res.r;
    const nodes = proofToTree(payload, { slots: payload.deleteSlots });
    const byStart = new Map(
      (payload.tacticEdits ?? []).map((e) => [
        `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`,
        e,
      ]),
    );
    const ctx = {
      nodes,
      slots: payload.deleteSlots ?? [],
      src: (p) => {
        const e = byStart.get(`${p.line}:${p.character}`);
        return e
          ? { start: e.start, stop: e.stop, text: e.text, indent: e.tacticIndent ?? e.start.character }
          : null;
      },
    };
    const check = async (edits) => {
      const t = Date.now();
      const r = await request("$/lean/rpc/call", {
        textDocument: { uri }, position: { line, character: col }, sessionId,
        method: "ProofTree.checkRewrite",
        params: { pos: { uri, line, character: col }, edits: edits.map((e) => ({ start: e.range.start, stop: e.range.end, newText: e.newText })) },
      });
      return { ...r, ms: Date.now() - t };
    };

    if (flags.rename) {
      // One row per HYPOTHESIS, not per drawn line: the same `h` is in every
      // goal below its binder and in both halves of a wrapped line.
      const seen = new Set();
      const rows = [];
      for (const g of nodes) {
        if (g.type !== "goal" || !g.hyps?.length) continue;
        for (const [j, r] of renamesFor(g, ctx)) {
          const l = g.hyps[j];
          const key = `${r.rewrite.targetId}:${l.hypName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const v = await check(r.rewrite.edits);
          rows.push({
            from: l.hypName, to: r.to, type: (l.hypType ?? "").slice(0, 28),
            rule: r.rule.id, edits: r.rewrite.edits.length,
            at: r.rewrite.edits.map((e) => `${e.range.start.line}:${e.range.start.character}`).join(" "),
            verdict: v.verdict, ms: v.ms, msg: (v.message ?? "").slice(0, 40),
          });
        }
      }
      console.log(`\n${rows.length} rename(s) offered`);
      console.table(rows);
    }

    if (flags.direct) {
      const rows = [];
      for (const c of contradictionShapes(nodes, ctx)) {
        const n = nodes.find((x) => x.id === c.nodeId);
        const at = `${n.position.start.line}:${n.position.start.character}`;
        if (!c.offer.ok) {
          rows.push({ at, head: c.head, goal: c.goal.slice(0, 28), negated: c.negated ? "yes" : "no", offered: "no", why: c.offer.why.slice(0, 52) });
          continue;
        }
        const v = await check(c.offer.rewrite.edits);
        rows.push({
          at, head: c.head, goal: c.goal.slice(0, 28), negated: "yes",
          offered: c.offer.rewrite.title.slice(0, 34),
          text: c.offer.rewrite.edits[0].newText,
          verdict: v.verdict, steps: `${v.before}→${v.steps}`, ms: v.ms,
          msg: (v.message ?? "").slice(0, 32),
        });
      }
      console.log(`\n${rows.length} contradiction shape(s)`);
      console.table(rows);
    }
  }
  if (flags.collapse || flags.expand) {
    const payload = res.r;
    const base = proofToTree(payload, { slots: payload.deleteSlots });
    const slots = payload.deleteSlots ?? [];
    const rpc = (method, params) =>
      request("$/lean/rpc/call", {
        textDocument: { uri }, position: { line, character: col }, sessionId,
        method, params,
      });

    if (flags.collapse) {
      const runs = linearRuns(base, hasSlot(slots));
      console.log(`\n${runs.length} linear run(s); ${runs.filter((r) => r.closes).length} close their goal`);
      const rows = [];
      for (const r of runs) {
        const at = `${r.steps[0].position.start.line}:${r.steps[0].position.start.character}`;
        if (!r.closes) { rows.push({ at, steps: r.steps.length, closes: "no" }); continue; }
        const t = Date.now();
        const v = await rpc("ProofTree.tryClose", {
          pos: { uri, line, character: col },
          from: r.steps[0].position.start,
          to: r.steps.at(-1).position.start,
        });
        const p = v.tactic ? collapseRewrite(r, { nodes: base, slots, src: () => null }, v.tactic) : null;
        rows.push({
          at, steps: r.steps.length, closes: "yes",
          head: r.steps[0].label.split("\n")[0].trim().slice(0, 22),
          tail: r.steps.at(-1).label.split("\n")[0].trim().slice(0, 18),
          won: v.tactic ?? "—", verdict: v.verdict,
          per: (v.tried ?? []).map((c, i) => `${c}:${(v.ms ?? [])[i]}ms`).join(" "),
          total: Date.now() - t,
          splice: p?.ok
            ? `${p.rewrite.edits[0].range.start.line}:${p.rewrite.edits[0].range.start.character}–${p.rewrite.edits[0].range.end.line}:${p.rewrite.edits[0].range.end.character}`
            : "",
          msg: (v.message ?? "").slice(0, 40),
        });
      }
      console.table(rows);
      console.log(`candidates, in order: ${AUTOMATION_CANDIDATES.join(" ")}`);
    }

    if (flags.expand) {
      const t0 = Date.now();
      const tr = await rpc("ProofTree.getAutomationTrace", { pos: { uri, line, character: col } });
      console.log(`\ntraces in ${Date.now() - t0}ms: ${(tr.traces ?? []).length}`);
      const traced = applyTraces(base, new Set(), traceIndex(tr.traces ?? []));
      const byStart = new Map(
        (payload.tacticEdits ?? []).map((e) => [
          `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`, e,
        ]),
      );
      const ctx = {
        nodes: traced, slots,
        src: (p) => {
          const e = byStart.get(`${p.line}:${p.character}`);
          return e ? { start: e.start, stop: e.stop, text: e.text, indent: e.tacticIndent ?? e.start.character } : null;
        },
      };
      const rows = [];
      for (const n of traced) {
        if (n.type !== "tactic" || !n.trace) continue;
        const p = expandRewrite(n, ctx);
        const at = `${n.position.start.line}:${n.position.start.character}`;
        if (!p.ok) { rows.push({ at, tactic: n.trace.tactic, offered: "no", why: p.why.slice(0, 52) }); continue; }
        const t = Date.now();
        const v = await rpc("ProofTree.checkRewrite", {
          pos: { uri, line, character: col },
          edits: p.rewrite.edits.map((e) => ({ start: e.range.start, stop: e.range.end, newText: e.newText })),
        });
        rows.push({
          at, tactic: n.trace.tactic, offered: "yes",
          text: p.rewrite.edits[0].newText.slice(0, 54),
          verdict: v.verdict, ms: Date.now() - t, msg: (v.message ?? "").slice(0, 36),
        });
      }
      console.table(rows);
    }
  }
  if (flags.trace) {
    const t0 = Date.now();
    const tr = await request("$/lean/rpc/call", { textDocument: { uri }, position: { line, character: col }, sessionId, method: "ProofTree.getAutomationTrace", params: { pos: { uri, line, character: col } } });
    console.error(`getAutomationTrace in ${Date.now() - t0}ms${tr.note ? ` — ${tr.note}` : ""}`);
    const t1 = Date.now();
    await request("$/lean/rpc/call", { textDocument: { uri }, position: { line, character: col }, sessionId, method: "ProofTree.getAutomationTrace", params: { pos: { uri, line, character: col } } });
    console.error(`cached call in ${Date.now() - t1}ms`);
    if (flags.json) console.log(JSON.stringify(tr, null, 2));
    else console.table((tr.traces ?? []).map((t) => ({
      at: `${t.stepStart.line}:${t.stepStart.character}`, tactic: t.tactic, kind: t.kind,
      lemmas: (t.lemmas ?? []).map((l) => l.name).join(" · ").slice(0, 90),
      docs: (t.lemmas ?? []).filter((l) => l.doc).length,
    })));
  }
}
try { await Promise.race([request("shutdown", null), new Promise((r) => setTimeout(r, 2000))]); notify("exit", null); } catch { /* the server may already be gone */ }
proc.kill();
process.exit(0);
