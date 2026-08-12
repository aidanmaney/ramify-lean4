import { useEffect, useState } from "react";
import {
  parseNdjson,
  stableProofOf,
  type Proof,
  type ProofRecord,
} from "./paperproof";
import { proofTitle } from "./proofToTree";
import ProofTreeView from "./ProofTreeView";

/** Dev-only replay of recorded WIDGET payloads (`?cf-replay=line:char`): fetch
`/payload-<name>.json` blobs dumped by the LSP probe, rebuild each into the
`Proof` the widget's `incoming` would build, and swap between them via
`window.__cfStep(i)` — the same prop-swap path the widget's stable machinery
drives, so view-stability bugs across a swap are reproducible (and measurable:
read `scrollTop` around the swap) without an editor. Files live in web/public,
uncommitted scratch. */
function CfReplay({ line, character }: { line: number; character: number }) {
  const [payloads, setPayloads] = useState<Record<string, unknown>[] | null>(
    null,
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    void Promise.all(
      ["baseline", "broken-0", "cf"].map((n) =>
        fetch(`${import.meta.env.BASE_URL}payload-${n}.json`).then((r) =>
          r.json(),
        ),
      ),
    ).then(setPayloads);
  }, []);
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
  // The widget's `incoming` rebuild — the SAME projection (stableProofOf), so
  // a field added to the widget's stable proof reaches the replay rig too
  // rather than silently measuring against a payload missing it.
  const proof = stableProofOf(p);
  return (
    <ProofTreeView
      proof={proof}
      highlightPos={pos}
      cfStub={
        p.cfLine != null ? { line: p.cfLine, draft: "…typing…" } : null
      }
    />
  );
}

// Where the committed sample proofs live (served from /public). This is the only
// data-source-specific code in the app: the renderer (ProofTreeView) is fed a
// plain `Proof`. The Lean infoview widget (widget.tsx) is the other data source —
// it fetches the same `Proof` over RPC instead of reading this file.
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample.ndjson`;

// The dev-harness query flags, parsed once: `location.search` is fixed for the
// page's life, so re-parsing it per render (one of them inside a JSX spread)
// was three allocations for a constant.
const QUERY = new URLSearchParams(location.search);
const REPLAY_AT = QUERY.get("cf-replay");
const STUB_EDIT = QUERY.has("stub-edit");
// `?cf-stub=<line>[:<draft>]`, parsed to the prop shape up front.
const CF_STUB = (() => {
  const v = QUERY.get("cf-stub");
  if (v === null) return null;
  const [line, ...rest] = v.split(":");
  return { line: Number(line), draft: rest.join(":") };
})();

export default function App() {
  const [records, setRecords] = useState<ProofRecord[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Dev-only widget-payload replay; see CfReplay. Checked before the sample
  // fetch effect does anything visible, but hooks must run unconditionally,
  // so the branch sits at render time below.

  // Load every proof in the sample once. The picker selects which to render.
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
    const [l, c] = REPLAY_AT.split(":").map(Number);
    return <CfReplay line={l || 0} character={c || 0} />;
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
    // A picker swap changes `proof`, and the view's own new-proof reset handles
    // it — the same in-place swap path the infoview widget exercises, so the dev
    // harness covers it too (a `key` remount here would bypass it).
    <ProofTreeView
      proof={proof!}
      // Dev-only editing stubs, on `?stub-edit`: the widget-only gestures
      // (in-place editing, the flag verbs, comment editing) are gated on
      // these hooks, so the preview harness can only drive them with fakes.
      // Writes land in `window.__edits` for the probe to read — the document
      // behind the NDJSON never changes, so the tree won't redraw; these
      // exist to verify ranges and gesture routing, not round trips.
      {...(STUB_EDIT
        ? {
            // The CLI wire already carries `deleteSlots` (it rides NDJSON so
            // probes can run the real extent math offline), but the view gates
            // the flag verbs, `⊘` delete and the arming row on the PROP — so
            // without this line the harness could never drive any of them,
            // even with the data sitting in the record. That blind spot is
            // what let the selection pill paint its chips in the wrong font
            // unnoticed; passing the wire's own slots closes it.
            deleteSlots: proof!.deleteSlots,
            getTacticEdit: (p: {
              start: { line: number; character: number };
            }) => ({
              pos: p as never,
              text: "«stub tactic»",
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
          }
        : {})}
      // Dev-only counterfactual stub, on `?cf-stub=<line>[:<draft>]`: the real
      // thing is widget-only (the server elaborates the counterfactual), so
      // this fakes the marker to make the overlay and its banner drawable in
      // the preview harness. Paint verification only — the underlying proof
      // is whatever the NDJSON holds.
      {...(CF_STUB ? { cfStub: CF_STUB } : {})}
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

// The proof-selection slot injected into the tree toolbar: a dropdown over every
// parsed proof plus a hover-revealed provenance line. Labels are the proof's root
// goal type, which is enough to tell theorems apart without the parser emitting
// names.
function ProofPicker({
  records,
  selected,
  onSelect,
}: {
  records: ProofRecord[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  // The source path/file is dev-harness provenance: in the Lean user-widget the
  // data arrives over RPC with no file behind it, so it's hidden by default and
  // revealed only on hover of the "proof" label.
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
          // A compact floater now (the view floats headerExtra at top-left
          // instead of a full-width bar), so keep it narrow; the option text
          // still shows in full in the dropdown itself.
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
