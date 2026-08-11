import { useEffect, useState } from "react";
import { parseNdjson, type ProofRecord } from "./paperproof";
import { proofTitle } from "./proofToTree";
import ProofTreeView from "./ProofTreeView";

// Where the committed sample proofs live (served from /public). This is the only
// data-source-specific code in the app: the renderer (ProofTreeView) is fed a
// plain `Proof`. The Lean infoview widget (widget.tsx) is the other data source —
// it fetches the same `Proof` over RPC instead of reading this file.
const SAMPLE_URL = `${import.meta.env.BASE_URL}sample.ndjson`;

export default function App() {
  const [records, setRecords] = useState<ProofRecord[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
      {...(new URLSearchParams(location.search).has("stub-edit")
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
