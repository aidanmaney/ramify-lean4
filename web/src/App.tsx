import { useEffect, useState } from "react";
import {
  parseNdjson,
  stableProofOf,
  type Proof,
  type ProofRecord,
} from "./paperproof";
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
    /** Click a button by the start of its `title` (rail, bar, pill chips). */
    button: async (titlePrefix: string, mods?: { alt?: boolean }) => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        (x.getAttribute("title") ?? "").startsWith(titlePrefix),
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
            }) => ({
              pos: p as never,
              text:
                proof!.steps.find(
                  (st) =>
                    st.position?.start.line === p.start.line &&
                    st.position?.start.character === p.start.character,
                )?.tacticString ?? "«stub tactic»",
            }),
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

      {...(CF_STUB ? { cfStub: CF_STUB } : {})}
      {...(cursor ? { highlightPos: cursor } : {})}

      {...(QUERY.get("hdr")
        ? {
            declHeader: QUERY.get("hdr")!.replace(/\\n/g, "\n"),
            onRevealHeader: () => {},
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
