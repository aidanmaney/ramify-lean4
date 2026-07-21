import { useContext, useEffect, useMemo, useRef, useState } from "react";
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
import {
  renderTacticTokens,
  type TacticToken,
  type TacticTokenInfo,
} from "./tacticTokens";

// Dwell before a hovered tactic lights up in the editor. Long enough that
// sweeping the pointer across the tree sends nothing.
const HOVER_DWELL_MS = 180;
// "clear" carries no meaningful range; the companion ignores it.
const ORIGIN = { line: 0, character: 0 };

// The tree gets PRIMACY in the infoview: the info card's body renders its
// sections as siblings (Tactic state, Expected type, panel widgets, then
// Messages — see the goals fragment in @leanprover/infoview), and the blocks
// ABOVE a widget change height on every cursor move, so the tree below them
// jumps around. There's no API for section order, but our widget lives in
// the same document, so a `:has()`-scoped stylesheet turns the hosting body
// into a flex column and orders the tree first — everything else flows
// BELOW it, so the tree's position is stable and the volatile blocks take
// space from the bottom, not the top. The widget's own <details> wrapper
// summary (the infoview names panel widgets) is dropped as chaff. Scoped
// entirely on [data-ptw-root] so no other infoview surface is touched.
const SECTION_ORDER_CSS = `
  div:has(> [data-ptw-root]),
  div:has(> details > [data-ptw-root]) {
    display: flex;
    flex-direction: column;
  }
  div:has(> [data-ptw-root]) > *,
  div:has(> details > [data-ptw-root]) > * {
    order: 1;
  }
  div:has(> [data-ptw-root]) > [data-ptw-root],
  div:has(> details > [data-ptw-root]) > details:has(> [data-ptw-root]) {
    order: 0;
  }
  details:has(> [data-ptw-root]) > summary {
    display: none;
  }
`;

function useSectionOrderCss() {
  useEffect(() => {
    const id = "ptw-section-order";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = SECTION_ORDER_CSS;
    document.head.appendChild(el);
    // Deliberately never removed: it is inert without a [data-ptw-root] in
    // the document, and widget remounts are frequent (cursor moves).
  }, []);
}

// One tactic's in-place editing seam, computed server-side (mirror of
// ProofTreeComments.lean's TacticEdit): the TIGHT range of the tactic text
// proper (trailing trivia trimmed — Paperproof step ranges include it) and
// that text verbatim. Keyed by `start`, which equals the step's
// `position.start`.
interface TacticEditEntry {
  start: { line: number; character: number };
  stop: { line: number; character: number };
  text: string;
  /** The server's semantic tokens for `text` — drives the label colouring. */
  tokens?: TacticToken[];
}

// The RPC payload: the CLI's `Proof` shape plus `taggedGoals`, each goal's
// interactive (tagged) pretty-print, plus `tacticEdits`. The tags hold live
// RPC references — valid only within this session, which is why they ride the
// RPC path and never the NDJSON one; the edits need an editor to apply to, so
// they're RPC-only too.
type ProofTreeData = Proof & {
  taggedGoals?: TaggedGoalEntry[];
  tacticEdits?: TacticEditEntry[];
  tokenInfos?: TacticTokenInfo[];
};

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
  useSectionOrderCss();

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
  // Everything here is PLAIN DATA — no RPC references (see `interactive`).
  // We adjust this during render (React's sanctioned pattern, cf. `prevEngine`
  // in ProofTreeView) rather than via a ref, which mustn't be read during render.
  const [stable, setStable] = useState<{
    sig: string;
    proof: Proof;
    tacticEdits: TacticEditEntry[];
  } | null>(null);
  if (st.state === "resolved" && st.value.steps.length > 0) {
    const proof: Proof = {
      steps: st.value.steps,
      allGoals: st.value.allGoals,
      comments: st.value.comments,
    };
    const sig = JSON.stringify(proof);
    if (!stable || stable.sig !== sig) {
      setStable({
        sig,
        proof,
        // Edits derive from the same source text as the steps, so refreshing
        // them exactly when the proof signature changes keeps their ranges
        // in sync with the document (positions live in the steps → any shift
        // changes the sig).
        tacticEdits: st.value.tacticEdits ?? [],
      });
    }
  }

  // The RPC-REFERENCE-carrying half of the payload, deliberately NOT kept in
  // `stable`. Refs (`WithRpcRef`) live in the file's RPC session store, and
  // `Lean.Widget.InteractiveDiagnostics.infoToInteractive` resolves them there
  // when a popup opens. A session dies on a worker crash/exit, a
  // RpcNeedsReconnect, a server restart or the file closing — and the client
  // then transparently opens a NEW one, whose store knows nothing of the old
  // ids. Any ref issued before that point is permanently dead.
  //
  // `stable` only updates when the proof TEXT changes, so pinning the tags
  // there meant rendering one arbitrarily old response's refs forever: after a
  // reconnect every popup failed with "RPC reference 'N' is not valid" and
  // nothing short of editing the proof could recover it. (`tokenInfos` made it
  // far more visible — one ref per identifier token rather than per goal.)
  //
  // So these track the LATEST successful in-proof response instead. Cursor
  // moves refresh them, which is exactly what makes a dead session self-heal:
  // the next call after the reconnect installs live refs. Identity-compared
  // against the response object, so the persistent value returned while a
  // refetch is in flight doesn't loop.
  const [interactive, setInteractive] = useState<{
    src: ProofTreeData | null;
    taggedGoals: TaggedGoalEntry[];
    tokenInfos: TacticTokenInfo[];
  }>({ src: null, taggedGoals: [], tokenInfos: [] });
  if (
    st.state === "resolved" &&
    st.value.steps.length > 0 &&
    interactive.src !== st.value
  ) {
    setInteractive({
      src: st.value,
      taggedGoals: st.value.taggedGoals ?? [],
      tokenInfos: st.value.tokenInfos ?? [],
    });
  } else if (st.state === "rejected" && interactive.src !== null) {
    // A failed call is the one signal we get that the session may be gone;
    // holding its refs afterwards can only produce dead popups.
    setInteractive({ src: null, taggedGoals: [], tokenInfos: [] });
  }

  // The tagged (hover-interactive) label renderers for this proof; see
  // taggedRender.tsx.
  const renderers = useMemo(
    () =>
      stable
        ? makeTaggedRenderers(stable.proof, interactive.taggedGoals)
        : null,
    [stable, interactive],
  );

  // Every companion request rides this one call. `void rs.call(...)` used to
  // swallow rejections whole, which made a broken relay indistinguishable from
  // a dead button — the RPC can fail for real (no HOME, unwritable request
  // dir, a stale RPC session after the server restarts), and none of it
  // surfaced. Failures now land in the widget's own error banner AND the
  // webview console, so "nothing happened" always has a reason attached.
  const [relayError, setRelayError] = useState<string | null>(null);
  const callCompanion = (action: string, p: ProofStepPosition) => {
    rs.call("ProofTree.popoutEdit", {
      uri: pos.uri,
      start: p.start,
      stop: p.stop,
      action,
    }).then(
      () => setRelayError(null),
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : JSON.stringify(e);
        console.error(`[proof-tree] ${action} RPC failed:`, e);
        setRelayError(`${action} failed: ${msg}`);
      },
    );
  };

  // tree→source: clicking a tactic node reveals its span in the editor —
  // routed through the COMPANION, not `ec.revealLocation`: vscode-lean4's
  // reveal targets the FIRST visible editor for the uri (always the main
  // buffer), while the companion targets the lens when one is open, which is
  // what closes the tree↔lens loop (the lens cursor move it causes flows
  // back as highlightPos). Without the companion installed, reveal is inert.
  const reveal = (p: ProofStepPosition) => callCompanion("reveal", p);

  // In-place editing: resolve a step's tight edit seam (double-click opens
  // the editor overlay pre-filled with `text`)…
  const editByStart = useMemo(
    () =>
      new Map(
        (stable?.tacticEdits ?? []).map((e): [string, TacticEditEntry] => [
          `${e.start.line}:${e.start.character}`,
          e,
        ]),
      ),
    [stable],
  );
  const getTacticEdit = (p: ProofStepPosition) => {
    const e = editByStart.get(`${p.start.line}:${p.start.character}`);
    return e ? { pos: { start: e.start, stop: e.stop }, text: e.text } : null;
  };
  // Syntax colouring for tactic labels, from the same per-step entry: the
  // tokens index into `text` (the verbatim source), which `renderTacticTokens`
  // aligns into the node's label — Paperproof's prettified `tacticString` and
  // the step's source disagree in both directions, so the label is passed too.
  // Hover popups ride the same call. `tokenInfos` is a flat list over the whole
  // proof, keyed by ABSOLUTE token position — so it is indexed once, globally,
  // and every tactic looks its own tokens up by position.
  //
  // It emphatically must NOT be bucketed by "the tactic whose range contains
  // this token": tactic ranges NEST (a structured `induction`/`have` contains
  // every tactic in its branches), so containment picks an ancestor rather than
  // the owner. Measured on sample.ndjson, 53 of 86 tactics had their tokens
  // attributed to an enclosing tactic and so rendered no popups at all.
  const infoAt = useMemo(
    () =>
      new Map(
        interactive.tokenInfos.map((i): [string, TacticTokenInfo["code"]] => [
          `${i.start.line}:${i.start.character}`,
          i.code,
        ]),
      ),
    [interactive],
  );

  const renderTaggedTactic = (
    p: ProofStepPosition,
    label: string,
    lines: string[],
  ) => {
    const e = editByStart.get(`${p.start.line}:${p.start.character}`);
    if (!e?.tokens) return null;
    return renderTacticTokens(e.text, e.start, e.tokens, label, lines, infoAt);
  };

  // …and commit by replacing the tight range in the document. Goes through
  // the editor's own edit pipeline (applyEdit), so it lands on the undo
  // stack and triggers re-elaboration; the tree redraws off the next RPC.
  const editTactic = (p: ProofStepPosition, newText: string) => {
    void ec.api.applyEdit({
      changes: { [pos.uri]: [{ range: { start: p.start, end: p.stop }, newText }] },
    });
  };

  // Hovering a tactic node paints a decoration over its range in the editor.
  // DEBOUNCED here rather than in the view: every request is a file write by
  // the Lean server plus an fs.watch wake-up in the companion, so firing on
  // each node the pointer crosses would hammer the relay. A dwell of
  // HOVER_DWELL_MS means only a deliberate hover sends anything, and the
  // "clear" is sent only if a highlight actually went out.
  const hoverTimer = useRef<number | null>(null);
  const highlighted = useRef(false);
  const hoverTactic = (p: ProofStepPosition | null) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (p === null) {
      if (highlighted.current) {
        highlighted.current = false;
        callCompanion("clear", { start: ORIGIN, stop: ORIGIN });
      }
      return;
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      highlighted.current = true;
      callCompanion("highlight", p);
    }, HOVER_DWELL_MS);
  };
  // Leaving the widget entirely (unmount) must not strand a decoration.
  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  // Rich editing (a tactic's hover-bar ⧉): open the tactic in the LENS — a slim
  // editor group the companion splits off directly below the infoview — with
  // the tactic's tight range selected. The real buffer in the same window,
  // so vim mode/LSP/keybindings all apply and edits sync with zero re-
  // elaboration cost. The infoview's EditorApi has no executeCommand, so the
  // request rides our own RPC channel: `ProofTree.popoutEdit` has the Lean
  // server write a request file under ~/.proof-tree-companion/, which the
  // companion extension (ext/proof-tree-companion) watches and executes.
  // Two rejected bridges, for the record: `showDocument({external: true})`
  // (vscode-lean4 ignores the flag and silently drops non-file URIs), and a
  // synthetic click on a `vscode://…` anchor (the webview only intercepts
  // TRUSTED clicks, so the synthetic one NAVIGATES the iframe — blank
  // infoview).
  const popoutEdit = (p: ProofStepPosition) => callCompanion("popout", p);

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
    // data-ptw-root even on the placeholder: the section order (tree slot
    // first) must not flip when the proof appears.
    return (
      <div
        data-ptw-root
        style={{ fontFamily: "monospace", fontSize: 12, color: "#888", padding: 4 }}
      >
        {msg}
      </div>
    );
  }

  // No <details>/summary wrapper: the tree is the panel's content, and every
  // chrome line above it costs vertical room the tree could use.
  return (
    <div data-ptw-root style={{ marginTop: "0.25rem" }}>
      {/* A failed companion request is otherwise invisible — the gesture just
          does nothing. Surfaced inline (dismissible) rather than as a console
          line nobody opens. */}
      {relayError && (
        <div
          onClick={() => setRelayError(null)}
          title="click to dismiss"
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            padding: "2px 6px",
            cursor: "pointer",
            color: "var(--vscode-errorForeground, #c53030)",
            background: "var(--vscode-inputValidation-errorBackground, #fff5f5)",
            border:
              "1px solid var(--vscode-inputValidation-errorBorder, #fc8181)",
            borderRadius: 3,
          }}
        >
          proof-tree: {relayError}
        </div>
      )}
      <ProofTreeView
        proof={stable.proof}
        onReveal={reveal}
        getTacticEdit={getTacticEdit}
        onEditTactic={editTactic}
        onPopoutEdit={popoutEdit}
        highlightPos={{ line: pos.line, character: pos.character }}
        height="100vh"
        renderTaggedGoal={renderers?.renderTaggedGoal}
        renderTaggedHyps={renderers?.renderTaggedHyps}
        renderTaggedTactic={renderTaggedTactic}
        onHoverTactic={hoverTactic}
      />
    </div>
  );
}
