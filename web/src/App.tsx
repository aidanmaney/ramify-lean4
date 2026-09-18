import { useEffect, useState } from "react";
import {
  parseNdjson,
  stableProofOf,
  type Proof,
  type ProofRecord,
} from "./paperproof";
import type { Lint } from "./lints";
import type { PolishLine } from "./narrate";
import { proofTitle } from "./proofToTree";
import ProofTreeView from "./ProofTreeView";

function CfReplay({
  line,
  character,
  set,
}: {
  line: number;
  character: number;
  set: string;
}) {
  const [payloads, setPayloads] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const names =
      set === "payload"
        ? ["baseline", "broken-0", "cf"]
        : ["baseline", "broken", "cf"];
    void Promise.all(
      names.map((n) =>
        fetch(`${import.meta.env.BASE_URL}${set}-${n}.json`).then((r) =>
          r.json(),
        ),
      ),
    ).then(setPayloads);
  }, [set]);
  const [pos, setPos] = useState({ line, character });
  useEffect(() => {
    const w = window as unknown as {
      __cfStep?: (i: number) => void;
      __cfPos?: (line: number, character: number) => void;
    };
    w.__cfStep = (i) => setIdx(i);
    w.__cfPos = (l, c) => setPos({ line: l, character: c });
  }, []);
  if (!payloads) return <div>loading replay…</div>;
  const p = payloads[idx] as unknown as Proof;

  const proof = stableProofOf(p);
  return (
    <ProofTreeView
      hypMarkStyle={HYP_MARK_STUB}
      proof={proof}
      highlightPos={pos}
      cfStub={
        p.cfLine != null
          ? {
              line: p.cfLine,
              pos: p.cfStubPos,

              draft: (p as { cfDraft?: string }).cfDraft ?? "…typing…",
              col: (p as { cfDraftCol?: number }).cfDraftCol,
            }
          : null
      }

      onEditTactic={(pos, text) => {
        const w = window as unknown as {
          __edits?: { pos: unknown; text: string }[];
        };
        w.__edits = [...(w.__edits ?? []), { pos, text }];
      }}
    />
  );
}

const QUERY = new URLSearchParams(location.search);
const SAMPLE_URL = `${import.meta.env.BASE_URL}${
  QUERY.get("ndjson") ?? "sample.ndjson"
}`;
const REPLAY_AT = QUERY.get("cf-replay");
const STUB_EDIT = QUERY.has("stub-edit");

const NO_LEDGER = QUERY.has("no-ledger");

const CF_STUB = (() => {
  const v = QUERY.get("cf-stub");
  if (v === null) return null;
  const [line, ...rest] = v.split(":");
  return { line: Number(line), draft: rest.join(":") };
})();

const CURSOR_STUB = (() => {
  const v = QUERY.get("cursor");
  if (v === null) return null;
  const [l, c] = v.split(":");
  return { line: Number(l) || 0, character: Number(c) || 0 };
})();

/** `?trace-stub` — B4 without a server. The harness has no RPC, so `onTrace`
 answers YES for every automation step and the view finds the trace in
 `proof.automationTraces` (`gen.sh --traces`). Without it the affordance is
 offered only where the corpus already carries a trace, which is what a reader
 of an untraced NDJSON should see. */
const TRACE_STUB = QUERY.has("trace-stub");

/** `?lint-stub` — D4 without a server. `ProofTree.lintDecl` re-elaborates the
 declaration with Mathlib's style linters on, and the harness has no server at
 all, so the `lints` reading option would have nothing to draw. This
 SYNTHESISES two lints from the record's own slot table — one shaped like
 `linter.style.cdot` (a one-token rewrite at the linter's own range) and one
 like `linter.unusedTactic` (the delete gesture's extent) — so the ribbon, the
 `<title>`, the bar's pager and the `✎` proposal can be seen and screenshotted
 offline. They are FICTIONS about the text they point at, and where the NDJSON
 carries real lints (`gen.sh --lint`) those win instead. */
const LINT_STUB = QUERY.has("lint-stub");

/** `?polish-stub` — C4 without a companion and without a key. The real path
 is widget → RPC → `polish-request.json` → the companion's API call →
 `polish-response.json` → a poll RPC, none of which exists here, so this
 FABRICATES the rewrite the model is asked for: the same sentence with its
 first letter raised and a full stop on the end. That is enough to see the
 `≈` strip, its wrap and its 2-line clamp, and to screenshot the path. The
 lines it was handed land in `window.__polish` so a probe can read them. */
const POLISH_STUB = QUERY.has("polish-stub");

/** `?propose-stub` — D6's hook without an agent. Picks the FIRST primitive the
 view offered (they arrive in DFS order, so that is the earliest move in the
 proof) and gives a reason naming it. The point is the plumbing: a choice
 among offered primitives, never free text. */
const PROPOSE_STUB = QUERY.has("propose-stub");

function stubLints(proof: Proof): Lint[] {
  // Only slots in a block of more than one tactic: deleting the sole tactic of
  // a block is not a fix (`lints.ts` declines it), and the stub should show
  // what the real thing shows.
  const usable = (proof.deleteSlots ?? []).filter((s) => s.count > 1);
  const out: Lint[] = [];
  const first = usable[0];
  if (first)
    out.push({
      start: first.start,
      stop: {
        line: first.start.line,
        character: first.start.character + 1,
      },
      linter: "linter.style.cdot",
      message: "Please, use `·` (typed as \\.) instead of `.` as 'cdot'.",
    });
  const last = usable[usable.length - 1];
  if (last && last !== first)
    out.push({
      start: last.start,
      stop: last.stop,
      linter: "linter.unusedTactic",
      message: "this tactic does nothing",
    });
  return out;
}

const HYP_MARK_STUB =
  QUERY.get("hypmark") === "underline" ? ("underline" as const) : undefined;

/** See the effect in `App` that installs this. Everything is DOM-derived. */
function installDriver() {
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const gs = () => [...document.querySelectorAll<SVGGElement>("g[data-node]")];
  // One entry per drawn LINE: a hyp block is one <text> with a <tspan> per
  // hypothesis, so a per-<text> split would glue `n : ℕ` and `key : …`.
  const textsOf = (g: SVGGElement) =>
    [...g.querySelectorAll("text")].flatMap((t) => {
      const spans = [...t.querySelectorAll("tspan")];
      return spans.length
        ? spans.map((s) => s.textContent ?? "")
        : [t.textContent ?? ""];
    });
  type Node = { id: string; texts: string[]; goal: boolean; brk: boolean };
  const node = (g: SVGGElement): Node => {
    const id = g.getAttribute("data-node") ?? "";
    const texts = textsOf(g);
    return {
      id,
      texts,
      goal: texts.some((t) => t.startsWith("⊢")),
      brk: id.startsWith("elide-") || id.startsWith("combine:"),
    };
  };
  const nodes = () => gs().map(node);
  const el = (id: string) =>
    document.querySelector<SVGGElement>(`g[data-node="${id}"]`);
  const fire = (
    target: Element | null,
    type: string,
    mods: { alt?: boolean; meta?: boolean; shift?: boolean } = {},
  ) =>
    !!target &&
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        altKey: !!mods.alt,
        metaKey: !!mods.meta,
        shiftKey: !!mods.shift,
      }),
    );
  const api = {
    wait,
    nodes,
    count: () => gs().length,
    ids: () => gs().map((g) => g.getAttribute("data-node") ?? ""),
    /** Nodes whose drawn text contains `s` (or that satisfy a predicate). */
    find: (s: string | ((n: Node) => boolean)) =>
      nodes().filter((n) =>
        typeof s === "string" ? n.texts.some((t) => t.includes(s)) : s(n),
      ),
    /** The goal listing hyp `has` (by name prefix) and not `hasNot`. */
    goalWithHyp: (has: string, hasNot?: string) =>
      nodes().find(
        (n) =>
          n.goal &&
          n.texts.some((t) => t.startsWith(`${has} :`)) &&
          !(hasNot && n.texts.some((t) => t.startsWith(`${hasNot} :`))),
      ) ?? null,
    breaks: () => nodes().filter((n) => n.brk),
    /** Click a node (goal fold/skip, ghost restore, …); `alt`/`meta` mods. */
    click: async (id: string, mods?: { alt?: boolean; meta?: boolean }) => {
      const ok = fire(el(id), "click", mods);
      await wait(400);
      return ok ? gs().length : -1;
    },
    dblclick: async (id: string) => {
      fire(el(id), "dblclick");
      await wait(400);
      return gs().length;
    },
    /** Click a button by the start of its tooltip text — `aria-label`, which
     is where the in-page tip reads it (rail, bar), else `title`. */
    button: async (titlePrefix: string, mods?: { alt?: boolean }) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.getAttribute("aria-label") ?? x.getAttribute("title") ?? "").startsWith(
          titlePrefix,
        ),
      );
      const ok = fire(b ?? null, "click", mods);
      await wait(500);
      return ok ? gs().length : -1;
    },
    /** Switch the picker to record `i` (an index into sample.ndjson). */
    select: async (i: number) => {
      const sel = document.querySelector<HTMLSelectElement>("#proof-picker");
      if (!sel) return -1;
      sel.value = sel.options[i].value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(900);
      return gs().length;
    },
    /** Record index whose picker label contains `s`. */
    which: (s: string) => {
      const sel = document.querySelector<HTMLSelectElement>("#proof-picker");
      return sel ? [...sel.options].findIndex((o) => (o.textContent ?? "").includes(s)) : -1;
    },
    background: async () => {
      const root = document.querySelector("[data-ptw-theme]");
      fire(root, "click");
      await wait(300);
      return gs().length;
    },
    key: async (key: string) => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await wait(300);
      return gs().length;
    },
  };
  (window as unknown as { __ptw: typeof api }).__ptw = api;
}

export default function App() {
  const [records, setRecords] = useState<ProofRecord[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [cursor, setCursor] = useState(CURSOR_STUB);
  // The harness DRIVER: `window.__ptw`, a small DOM-level API so a probe run
  // through the browser tools can select a proof, find a node by what it
  // shows, click it (with modifiers) and count what is drawn — in one
  // expression instead of a hand-rolled querySelector each time. It knows
  // nothing about the view's internals (ids come off `g[data-node]`, text off
  // the `<text>` elements, buttons off their titles), which is the point: it
  // measures what a reader sees. Installed once, standalone app only.
  useEffect(() => {
    installDriver();
  }, []);
  useEffect(() => {
    if (CURSOR_STUB === null) return;
    const w = window as unknown as {
      __cursor?: (line: number, character: number) => void;
    };
    w.__cursor = (line, character) => setCursor({ line, character });
  }, []);

  useEffect(() => {
    fetch(SAMPLE_URL)
      .then((r) => r.text())
      .then((text) => {
        const recs = parseNdjson(text);
        if (recs.length === 0) throw new Error("no proofs in sample");
        setRecords(recs);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const proof = records?.[selected]?.data.proof ?? null;

  if (REPLAY_AT !== null) {
    const [l, c, set] = REPLAY_AT.split(":");
    return (
      <CfReplay
        line={Number(l) || 0}
        character={Number(c) || 0}
        set={set || "payload"}
      />
    );
  }

  if (error || !records) {
    return (
      <div
        style={{
          position: "fixed",
          top: 48,
          left: 12,
          zIndex: 10,
          fontFamily: "monospace",
          fontSize: 13,
          color: error ? "#c53030" : "#666",
        }}
      >
        {error ? `Failed to load proofs: ${error}` : "Loading…"}
      </div>
    );
  }

  return (
    <ProofTreeView
      hypMarkStyle={HYP_MARK_STUB}
      proof={proof!}
      ledger={!NO_LEDGER}

      {...(STUB_EDIT
        ? {
            deleteSlots: proof!.deleteSlots,
            // The step's OWN text, not a placeholder: the widget's real
            // `tacticEdits` hand back verbatim source, so a stub that answers
            // a constant makes every geometry measurement in the harness
            // (overlay width against box width, first glyph against first
            // glyph) a measurement of the stub instead of the editor.
            getTacticEdit: (p: {
              start: { line: number; character: number };
            }) => {
              // The TIGHT range, taken from `deleteSlots` — the widget's real
              // `tacticEdits` are tight, and a step's own `position` runs to
              // the next tactic through the trailing trivia. D1's rewrites
              // check the text against the range it claims before they cut
              // anything out of it, so a trivia-inclusive stop here would
              // decline every rewrite in the harness.
              const slot = (proof!.deleteSlots ?? []).find(
                (s) =>
                  s.start.line === p.start.line &&
                  s.start.character === p.start.character,
              );
              return {
                pos: (slot
                  ? { start: slot.start, stop: slot.stop }
                  : p) as never,
                text:
                  proof!.steps.find(
                    (st) =>
                      st.position?.start.line === p.start.line &&
                      st.position?.start.character === p.start.character,
                  )?.tacticString ?? "«stub tactic»",
                indent: p.start.character,
              };
            },
            onEditTactic: (
              pos: unknown,
              text: string,
            ) => {
              const w = window as unknown as {
                __edits?: { pos: unknown; text: string }[];
              };
              w.__edits = [...(w.__edits ?? []), { pos, text }];
            },

            onDeleteTactic: (spec: unknown) => {
              const w = window as unknown as { __deletes?: unknown[] };
              w.__deletes = [...(w.__deletes ?? []), spec];
            },

            // D1 — the WRITE is stubbed; the CHECK is not wired at all, which
            // is deliberate: with no `onCheckRewrite` the proposal goes
            // straight to ✓, so the pill and both gestures can be seen and
            // measured offline while the verdict stays the server's alone.
            // Note that the harness's `getTacticEdit` above answers with
            // Paperproof's pretty-print rather than verbatim source, so
            // `rewrite.ts`'s verbatim guard declines every multi-line tactic
            // here that the widget would offer.
            // D2's writes land in the same place, and so does the run the
            // collapse would splice: `__rewrites` is every proposal the
            // reader accepted, in order.
            onApplyRewrite: (edits: unknown, renameAt?: unknown) => {
              const w = window as unknown as {
                __rewrites?: unknown[];
                __companion?: unknown[];
              };
              w.__rewrites = [...(w.__rewrites ?? []), edits];
              // The extract's rename follow-up: what widget.tsx hands the
              // companion (`action: "rename"` at the written `this` binder).
              if (renameAt)
                w.__companion = [
                  ...(w.__companion ?? []),
                  { action: "rename", pos: renameAt },
                ];
            },

            onAddTactic: (spec: unknown, text: string) => {
              const w = window as unknown as {
                __adds?: { spec: unknown; text: string }[];
              };
              w.__adds = [...(w.__adds ?? []), { spec, text }];
              return { fill: null };
            },

            onReveal: (pos: unknown) => {
              const w = window as unknown as { __reveals?: unknown[] };
              w.__reveals = [...(w.__reveals ?? []), pos];
            },
          }
        : {})}

      {...(TRACE_STUB
        ? {
            onTrace: async (pos: { start: { line: number; character: number } }) => {
              const w = window as unknown as { __traces?: unknown[] };
              w.__traces = [...(w.__traces ?? []), pos];
              return (proof!.automationTraces ?? []).some(
                (t) =>
                  t.stepStart.line === pos.start.line &&
                  t.stepStart.character === pos.start.character,
              );
            },
          }
        : {})}

      {...(LINT_STUB
        ? {
            lints: proof!.lints?.length ? proof!.lints : stubLints(proof!),
          }
        : {})}

      {...(POLISH_STUB
        ? {
            polishReady: true,
            polishDefault: false,
            onPolish: async (lines: PolishLine[]) => {
              const w = window as unknown as { __polish?: PolishLine[] };
              w.__polish = lines;
              return lines.map((l) => ({
                nodeId: l.nodeId,
                text:
                  l.template.charAt(0).toUpperCase() +
                  l.template.slice(1) +
                  (/[.!?]$/.test(l.template) ? "" : "."),
              }));
            },
          }
        : {})}

      {...(PROPOSE_STUB
        ? {
            proposeReady: true,
            onPropose: async (req: {
              text: string;
              primitives: { nodeId: string; kind: string; title: string }[];
            }) => {
              const w = window as unknown as { __proposals?: unknown[] };
              w.__proposals = [...(w.__proposals ?? []), req];
              const first = req.primitives[0];
              return first
                ? {
                    nodeId: first.nodeId,
                    kind: first.kind,
                    reason: `the earliest move offered (${first.kind})`,
                  }
                : { note: "no primitive offered" };
            },
          }
        : {})}

      {...(CF_STUB ? { cfStub: CF_STUB } : {})}
      {...(cursor ? { highlightPos: cursor } : {})}

      {...(QUERY.get("hdr")
        ? {
            declHeader: QUERY.get("hdr")!.replace(/\\n/g, "\n"),
            // The server's by-kind split, stubbed: `&hdr-name=l:c&hdr-sig=l:c`
            // against a header starting at 0:0 (the NDJSON carries no header).
            declHeaderStart: { line: 0, character: 0 },
            ...(QUERY.get("hdr-name")
              ? { declHeaderNameStop: stubPos(QUERY.get("hdr-name")!) }
              : {}),
            ...(QUERY.get("hdr-sig")
              ? { declHeaderSigStop: stubPos(QUERY.get("hdr-sig")!) }
              : {}),
            // Records each reveal-in-source in `window.__reveals`.
            onRevealHeader: () => {
              const w = window as unknown as { __reveals?: number };
              w.__reveals = (w.__reveals ?? 0) + 1;
            },
          }
        : {})}
      headerExtra={
        <ProofPicker
          records={records}
          selected={selected}
          onSelect={setSelected}
        />
      }
    />
  );
}

function stubPos(q: string): { line: number; character: number } {
  const [line, character] = q.split(":").map(Number);
  return { line: line || 0, character: character || 0 };
}

function ProofPicker({
  records,
  selected,
  onSelect,
}: {
  records: ProofRecord[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  const [showPath, setShowPath] = useState(false);
  return (
    <>
      <label
        htmlFor="proof-picker"
        style={{ color: "#4a5568", cursor: "help" }}
        onMouseEnter={() => setShowPath(true)}
        onMouseLeave={() => setShowPath(false)}
      >
        proof
      </label>
      <select
        id="proof-picker"
        value={selected}
        onChange={(e) => onSelect(Number(e.target.value))}
        style={{
          fontFamily: "monospace",
          fontSize: 13,

          maxWidth: 260,
          minWidth: 120,
          flexShrink: 1,
        }}
      >
        {records.map((rec, i) => (
          <option key={i} value={i}>
            #{rec.data.index} ⊢ {proofTitle(rec.data.proof)}
          </option>
        ))}
      </select>
      <span
        style={{
          color: "#a0aec0",
          opacity: showPath ? 1 : 0,
          transition: "opacity 0.15s",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        {records[selected]?.file} · {records.length} proof
        {records.length === 1 ? "" : "s"}
      </span>
    </>
  );
}
