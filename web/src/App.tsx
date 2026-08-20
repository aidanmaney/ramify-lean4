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
  // The widget's `incoming` rebuild — the SAME projection (stableProofOf), so
  // a field added to the widget's stable proof reaches the replay rig too
  // rather than silently measuring against a payload missing it.
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
              // The payload's OWN draft, not a placeholder: what the overlay
              // paints (and how wide it gets) is exactly what the widget
              // would show, so a width-dependent paint bug reproduces here.
              draft: (p as { cfDraft?: string }).cfDraft ?? "…typing…",
              col: (p as { cfDraftCol?: number }).cfDraftCol,
            }
          : null
      }
      // The stub's own editor is gated on this hook like every other edit;
      // writes land in `window.__edits` so a probe can read the RANGE, which
      // is the whole thing worth checking here (it must be the REAL line's).
      onEditTactic={(pos, text) => {
        const w = window as unknown as {
          __edits?: { pos: unknown; text: string }[];
        };
        w.__edits = [...(w.__edits ?? []), { pos, text }];
      }}
    />
  );
}

// Where the committed sample proofs live (served from /public). This is the only
// data-source-specific code in the app: the renderer (ProofTreeView) is fed a
// plain `Proof`. The Lean infoview widget (widget.tsx) is the other data source —
// it fetches the same `Proof` over RPC instead of reading this file.
// The dev-harness query flags, parsed once: `location.search` is fixed for the
// page's life, so re-parsing it per render (one of them inside a JSX spread)
// was three allocations for a constant.
const QUERY = new URLSearchParams(location.search);
const SAMPLE_URL = `${import.meta.env.BASE_URL}${
  // PROTOTYPE harness flag: read another harvest out of /public instead
  // (`?ndjson=tour.ndjson`), so a fixture that is not part of the tracked
  // corpus can be looked at without editing the corpus.
  QUERY.get("ndjson") ?? "sample.ndjson"
}`;
const REPLAY_AT = QUERY.get("cf-replay");
const STUB_EDIT = QUERY.has("stub-edit");
// PROTOTYPE: `?no-ledger` restores the per-link goal boxes a `calc` chain drew
// before the ledger, so the two readings can be screenshotted from one build.
const NO_LEDGER = QUERY.has("no-ledger");
// `?cf-stub=<line>[:<draft>]`, parsed to the prop shape up front. Line only,
// so this drives the overlay's FALLBACK node rule; the exact-position path
// (`cfStubPos`, which only a real server mints) is exercised by `?cf-replay`
// over recorded payloads.
const CF_STUB = (() => {
  const v = QUERY.get("cf-stub");
  if (v === null) return null;
  const [line, ...rest] = v.split(":");
  return { line: Number(line), draft: rest.join(":") };
})();
// Dev-only editor-cursor stub, on `?cursor=<line>[:<char>]` (0-based, LSP
// coordinates like the wire's): `highlightPos` is widget-only, so without
// this the harness cannot draw the cursor accent or drive anything gated on
// a cursor — the ⤓ up-to-here mode most of all, whose whole content is
// "where the cursor is". A probe moves it without a reload via
// `window.__cursor(line, char)` (the CfReplay `__cfPos` pattern).
const CURSOR_STUB = (() => {
  const v = QUERY.get("cursor");
  if (v === null) return null;
  const [l, c] = v.split(":");
  return { line: Number(l) || 0, character: Number(c) || 0 };
})();

// `ramify.hypMarkStyle`, stubbed. The real setting rides the companion's
// settings file, which the standalone app has no route to — so without this
// the underline VARIANT is undrawable here and the only gate on it would be
// the editor. `?hypmark=underline` (the CURSOR_STUB pattern).
const HYP_MARK_STUB =
  QUERY.get("hypmark") === "underline" ? ("underline" as const) : undefined;

export default function App() {
  const [records, setRecords] = useState<ProofRecord[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Dev-only stubbed cursor (see CURSOR_STUB); null when the flag is absent,
  // in which case the prop below stays undefined and nothing here changes.
  const [cursor, setCursor] = useState(CURSOR_STUB);
  useEffect(() => {
    if (CURSOR_STUB === null) return;
    const w = window as unknown as {
      __cursor?: (line: number, character: number) => void;
    };
    w.__cursor = (line, character) => setCursor({ line, character });
  }, []);
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
    // A picker swap changes `proof`, and the view's own new-proof reset handles
    // it — the same in-place swap path the infoview widget exercises, so the dev
    // harness covers it too (a `key` remount here would bypass it).
    <ProofTreeView
      hypMarkStyle={HYP_MARK_STUB}
      proof={proof!}
      ledger={!NO_LEDGER}
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
            // `⊘` and its ARMED confirm row are gated on this hook as well as
            // on `deleteSlots` (`caps.del` is the conjunction), so passing the
            // slots alone left the whole delete gesture undrawable here — the
            // third instance of exactly the blind spot the two comments around
            // this one record, and the one that hid the armed row's confirm
            // chips crossing a connector. Writes land in `window.__deletes`;
            // the document behind the NDJSON never changes, so nothing redraws.
            onDeleteTactic: (spec: unknown) => {
              const w = window as unknown as { __deletes?: unknown[] };
              w.__deletes = [...(w.__deletes ?? []), spec];
            },
            // The FRONTIER chips (`+`/`sorry`/`calc`) are gated on this hook
            // alone, and the lane is not even reserved without it — so until
            // it was stubbed the harness could not draw a chip at all, however
            // complete the record. The same blind spot as `deleteSlots` above,
            // and it hid the whole open-block frontier (`proofs/openblock.lean`),
            // which is a payload with exactly one node and nothing but chips
            // on it. Returns no fill: nothing is written, so there is no stub
            // to open the second half of a gesture on.
            onAddTactic: (spec: unknown, text: string) => {
              const w = window as unknown as {
                __adds?: { spec: unknown; text: string }[];
              };
              w.__adds = [...(w.__adds ?? []), { spec, text }];
              return { fill: null };
            },
            // Reveal-in-source, the fourth hook the harness was blind to: a
            // tactic is `revealable` only where this exists, and that predicate
            // decides what a plain click on a tactic DOES (reveal in the widget,
            // fold here) and whether the box draws a fold mark at all. Without
            // it every tactic in the harness took the standalone branch, so the
            // shipping click routing was the one thing the preview could not
            // show — including a COLLAPSED tactic's `+` and the click that
            // opens it, which is what an absorbed `rw` residue hangs on.
            // Positions land in `window.__reveals`; nothing else happens, since
            // there is no editor behind the NDJSON.
            onReveal: (pos: unknown) => {
              const w = window as unknown as { __reveals?: unknown[] };
              w.__reveals = [...(w.__reveals ?? []), pos];
            },
          }
        : {})}
      // Dev-only counterfactual stub, on `?cf-stub=<line>[:<draft>]`: the real
      // thing is widget-only (the server elaborates the counterfactual), so
      // this fakes the marker to make the overlay and its banner drawable in
      // the preview harness. Paint verification only — the underlying proof
      // is whatever the NDJSON holds.
      {...(CF_STUB ? { cfStub: CF_STUB } : {})}
      {...(cursor ? { highlightPos: cursor } : {})}
      // Dev-only signature header, on `?hdr=<text>` (use `\n` for line
      // breaks): `declHeader` is widget-only — the CLI wire ships no source
      // text — so this fakes it to make the bar, its wrapping and the floater
      // offset drawable in the preview harness. Paint verification only; there
      // is no colouring here, which is the widget's `renderDeclHeader`.
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
