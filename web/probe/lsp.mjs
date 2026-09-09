// The LIVE-SERVER probe: drive the real Lean language server the way
// vscode-lean4 does and call the widget's own RPC, so widget-only data
// (diagnostics, taggedGoals, tokenInfos, counterfactual, openBlock) and the
// live-server timing can be measured instead of guessed at from the CLI —
// three bugs in one day were invisible to every offline probe and fell to this.
//
//   npm run probe -- lsp <file.lean> <line> <col> [--json] [--cf=0] [--all]
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
    if (msg.id !== undefined && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
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

console.error(`elaborated ${path.basename(abs)} in ${tElab}ms`);
if (flags.all) {
  const lines = text.split("\n");
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(theorem|lemma|example)\b.*:=\s*by\s*$/.exec(lines[i]) ?? (/^(theorem|lemma|example)\b/.test(lines[i]) ? { index: 0 } : null);
    if (!m) continue;
    // the `by` line: the first line at or after the head ending in `:= by`
    let j = i; while (j < lines.length && !/:=\s*by\s*(--.*)?$/.test(lines[j])) j++;
    if (j >= lines.length) continue;
    rows.push(row(j + 1, 2, await call(j + 1, 2)));
    i = j;
  }
  console.table(rows);
} else {
  const line = Number(lineS ?? 0), col = Number(colS ?? 0);
  const res = await call(line, col);
  if (flags.json) console.log(JSON.stringify(res.r, null, 2));
  else console.log(row(line, col, res));
}
try { await Promise.race([request("shutdown", null), new Promise((r) => setTimeout(r, 2000))]); notify("exit", null); } catch { /* the server may already be gone */ }
proc.kill();
process.exit(0);
