import { useContext, useMemo, useState } from "react";
import {
  EditorContext,
  useRpcSession,
  useAsyncPersistent,
  mapRpcError,
  type PanelWidgetProps,
} from "@leanprover/infoview";
import type { Proof, ProofStepPosition } from "./paperproof";
import ProofTreeView from "./ProofTreeView";
import { makeTaggedRenderers, type TaggedGoalEntry } from "./taggedRender";

// The RPC payload: the CLI's `Proof` shape plus `taggedGoals`, each goal's
// interactive (tagged) pretty-print. The tags hold live RPC references — valid
// only within this session, which is why they ride the RPC path and never the
// NDJSON one.
type ProofTreeData = Proof & { taggedGoals?: TaggedGoalEntry[] };

// The Lean infoview user-widget entry point. This is the default export bundled
// into `web/dist/proofTreeWidget.js` and loaded by `ProofTreeWidget`
// (lean/ProofTreeWidget.lean). It is the widget counterpart of App.tsx: instead
// of fetching NDJSON, it calls the `ProofTree.getProofTree` RPC for the theorem
// under the cursor and feeds the result to the shared ProofTreeView, wiring the
// two directions of the node↔source link (see below).

export default function ProofTreeWidget(props: PanelWidgetProps) {
  const rs = useRpcSession();
  const ec = useContext(EditorContext);
  const pos = props.pos; // DocumentPosition: { uri, line, character }

  // Re-parse whenever the cursor moves; the server's snapshot is cached, so this
  // is cheap, and it is what makes the tree "follow the cursor". The server
  // returns an EMPTY proof (`steps: []`) when the cursor isn't inside a tactic
  // proof — that's a normal outcome, not an error (see getProofTree).
  const st = useAsyncPersistent<ProofTreeData>(
    () =>
      rs.call<{ pos: typeof pos }, ProofTreeData>("ProofTree.getProofTree", {
        pos,
      }),
    [rs, pos.uri, pos.line, pos.character],
  );

  // Hold the last rendered NON-EMPTY proof, keyed by the payload's TEXT parts,
  // so re-highlighting on cursor moves within a proof doesn't churn the layout
  // or fold state, and moving the cursor out of the proof keeps the tree up.
  // The tagged goals are excluded from the signature on purpose: their RPC
  // references are freshly allocated on every call, so keying on them would
  // treat every cursor move as a new proof. Within one RPC session the old
  // references stay valid, so keeping the first response's tags is correct.
  // We adjust this during render (React's sanctioned pattern, cf. `prevEngine`
  // in ProofTreeView) rather than via a ref, which mustn't be read during render.
  const [stable, setStable] = useState<{
    sig: string;
    proof: Proof;
    taggedGoals: TaggedGoalEntry[];
  } | null>(null);
  if (st.state === "resolved" && st.value.steps.length > 0) {
    const proof: Proof = { steps: st.value.steps, allGoals: st.value.allGoals };
    const sig = JSON.stringify(proof);
    if (!stable || stable.sig !== sig) {
      setStable({ sig, proof, taggedGoals: st.value.taggedGoals ?? [] });
    }
  }

  // The tagged (hover-interactive) label renderers for this proof; see
  // taggedRender.tsx. Rebuilt only when the stable proof actually changes.
  const renderers = useMemo(
    () =>
      stable ? makeTaggedRenderers(stable.proof, stable.taggedGoals) : null,
    [stable],
  );

  // tree→source: clicking a tactic node reveals its span in the editor.
  const reveal = (p: ProofStepPosition) => {
    void ec.revealLocation({
      uri: pos.uri,
      range: { start: p.start, end: p.stop },
    });
  };

  // Until a proof has rendered, surface the three transient states: a genuine
  // RPC failure, the empty "not in a proof" result, or still loading. Once a
  // tree is up, all three quietly keep the last proof on screen instead.
  if (!stable) {
    const msg =
      st.state === "rejected"
        ? `Proof tree error: ${mapRpcError(st.error).message}`
        : st.state === "resolved"
          ? "No proof tree here — place the cursor inside a tactic proof."
          : "Loading proof tree…";
    return (
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888", padding: 4 }}>
        {msg}
      </div>
    );
  }

  return (
    <details open style={{ marginTop: "0.25rem" }}>
      <summary style={{ cursor: "pointer" }}>Proof tree</summary>
      <ProofTreeView
        proof={stable.proof}
        onReveal={reveal}
        highlightPos={{ line: pos.line, character: pos.character }}
        height="70vh"
        renderTaggedGoal={renderers?.renderTaggedGoal}
        renderTaggedHyps={renderers?.renderTaggedHyps}
      />
    </details>
  );
}
