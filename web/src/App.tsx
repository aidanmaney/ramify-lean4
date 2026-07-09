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
          maxWidth: "50vw",
          minWidth: 160,
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
