import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  EditorContext,
  useRpcSession,
  useAsyncPersistent,
  useServerNotificationEffect,
  mapRpcError,
  type PanelWidgetProps,
} from "@leanprover/infoview";
import type { Proof, ProofStepPosition, TacticSlot } from "./paperproof";
import type { AddResult, AddSpec, DeleteSpec, TextSlot } from "./types";
import { DEFAULT_ABBREV, type AbbrevConfig } from "./abbreviation";
import { calcEdit, fillRange, offsetToPosition } from "./calcEdit";
import { deleteEdit } from "./deleteEdit";
import {
  filterDiagnostics,
  proofSpan,
  type RawDiagnostic,
  type TreeDiagnostic,
} from "./diagnostics";
import { goalAnnotations, type GoalAnnotation } from "./lensGoals";
import ProofTreeView from "./ProofTreeView";
import {
  injectStyleOnce,
  makeTaggedRenderers,
  type TaggedGoalEntry,
} from "./taggedRender";
import { taggedSubterms } from "./taggedText";
import { observeThemeChange } from "./theme";
import {
  makeTacticRenderer,
  type TacticToken,
  type TacticTokenInfo,
} from "./tacticTokens";

// Dwell before a hovered tactic lights up in the editor. Long enough that
// sweeping the pointer across the tree sends nothing.
const HOVER_DWELL_MS = 180;
// Trailing debounce on document-change re-parses: elaboration publishes
// diagnostics several times as it progresses, and only the last one is worth
// re-parsing at. Short enough that a committed edit redraws immediately.
const DOC_SETTLE_MS = 120;
// The TYPING HOLD: how long a changed proof text must sit quiet before the
// tree swaps it in (see the `stable` machinery below). DOC_SETTLE_MS alone
// cannot do this job — it coalesces the diagnostics burst WITHIN one
// elaboration round, while typing produces a fresh round per keystroke, each
// with a genuinely different proof text that passed the signature gate and
// relaid the tree out (per keystroke, through broken intermediates: `ri` is a
// failed tactic, so the recovery node and error ribbon flickered too — the
// reported "shudder"). Default only; `proofTree.typingHoldMs` overrides it
// over the companion channel, and 0 restores the old swap-immediately
// behaviour.
const DEFAULT_TYPING_HOLD_MS = 600;
// Ceiling on the setting: past a few seconds a "hold" reads as the tree being
// broken, not settling.
const TYPING_HOLD_MAX_MS = 5000;
// After the widget itself writes the document (applyEdit, undo/redo), the
// next re-elaboration is that edit's own — the tree should redraw promptly,
// not sit out the typing hold. A window rather than a one-shot flag: the
// first payload after an edit can be a stale elaboration finishing, and a
// flag consumed by it would hold the real redraw instead.
const EXPECT_EDIT_WINDOW_MS = 3000;
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
// space from the bottom, not the top. Scoped entirely on [data-ptw-root] so
// no other infoview surface is touched.
//
// The last rule drops the summary of an INFOVIEW-supplied <details> wrapper,
// which would name the panel a second time. That wrapper does not currently
// exist for us — core sets `PanelWidgetInstance.name?` only for the deprecated
// `UserWidgetDefinition` form — so the rule is defensive. It must not be
// widened to `details > summary`: the panel's own fold, built at the end of
// this file, is a <details> INSIDE [data-ptw-root], and hiding its summary
// would take the fold away.
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
    injectStyleOnce("ptw-section-order", SECTION_ORDER_CSS);
  }, []);
}

// Floor for the measured frame height. A transient bad measurement (the
// infoview mid-reflow, a hidden webview reporting zeros) must degrade to a
// short tree, never to no tree.
const MIN_FRAME_PX = 240;

// How much of the room below the tree's top the frame actually takes.
//
// Filling it exactly (the first version, 1.0) is worse than it sounds: the tree
// then ends precisely at the fold, so the sections it was ordered above are all
// off-screen, and since the tree's own scroll container swallows the wheel, the
// only way to scroll the infoview page is to find the strip of document beside
// it. Stopping short leaves the next heading showing — both a place to put the
// pointer and a reminder that the column continues.
//
// Which of the two is right is a real preference rather than a fact about the
// layout: the room below the fold is not dead (the restart-file button takes a
// scroll perfectly well), and a tree that reaches the edge is worth more to
// some readers than a strip they never aim at. So the default keeps the strip
// and `proofTree.tallFrame` gives most of it back — deliberately NOT all of it,
// since a frame that ends flush with the fold leaves the page with no
// wheel-target of its own inside the widget's own span.
const FRAME_FRACTION = 0.9;
const FRAME_FRACTION_TALL = 0.95;

/** The tree's frame height: the viewport MINUS the root's own offset from the
document top, measured live.

A flat `100vh` was the first version and it overhangs: the root sits a little
way down the infoview's document (the section-order CSS puts the tree first
within its card, but the infoview's own chrome still stands above it), so a
100vh frame ends exactly that far BELOW the fold — the bottom edge of the tree
was never on screen, which is why nothing could ever be anchored to it (the
pill lived through this) and why the view's `viewport` state over-reported by
the same offset.

Measured live rather than once, because the offset MOVES: the infoview reflows
on every cursor move as the blocks around the widget change height, and VS Code
resizing the panel changes `100vh` but a theme banner appearing above changes
the offset. The `ResizeObserver` on `document.body` catches the reflows (any
content change above the tree changes the body's size); the `resize` listener
catches the webview frame itself. Re-measuring is settled by a 1px hysteresis:
setting the height changes the body height, which re-fires the observer, which
re-measures the SAME offset and writes nothing — one bounce, then stable.

ResizeObserver delivery rides the RENDERING steps, like animation frames — so
a hidden webview delivers nothing (measured in the preview: zero firings,
including the mandatory on-observe one). That is fine rather than a bug to
paper over: a hidden tree needs no remeasure, and the pending delivery lands
on the first rendered frame when the webview becomes visible — which is
exactly when the answer matters. The explicit `measure()` on mount covers the
visible-from-birth case without waiting a frame.

Returns the offset in px; the caller renders
`calc((100vh - <offset>px) * FRAME_FRACTION)`. The
ref must be ATTACHED to the element whose top is being measured (the tree's
root div). Reads happen only in the effect — the `react-hooks/refs` line this
codebase already walks. */
function useFrameOffset(): {
  rootRef: React.RefObject<HTMLDivElement | null>;
  offset: number;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      // A COLLAPSED panel yields no honest answer, and the two ways a browser
      // can say so were BOTH measured, because Chromium changed which one it
      // uses and a VS Code webview can be either vintage:
      //   · older — closed <details> puts `display: none` on its non-summary
      //     children, so there are no client rects and every rect reads 0;
      //   · current — the content is skipped via `::details-content`'s
      //     `content-visibility: hidden`, which keeps STALE boxes: rects
      //     survive and still report the geometry from when it was last open
      //     (measured: rects 1, top 47, height 400 while closed and
      //     contributing nothing to layout). Only `checkVisibility()` tells
      //     the truth here.
      // A zero is not an offset of zero, it is the absence of an answer, and
      // writing it would size the frame to a full viewport and flash the tree
      // at that height on the next expand. Both tests, so neither vintage
      // slips through; nothing is lost when they fire, since the offset starts
      // at 0 anyway and skipping can only ever preserve a better earlier
      // reading.
      if (el.getClientRects().length === 0) return;
      if (el.checkVisibility && !el.checkVisibility()) return;
      // Distance from the DOCUMENT's top, not the viewport's: the infoview
      // page itself scrolls (the tree is its first section, so content below
      // always overflows), and rect.top alone would shrink the tree by however
      // far the user happened to have scrolled at measure time.
      const top = el.getBoundingClientRect().top + window.scrollY;
      setOffset((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { rootRef, offset };
}

// One tactic's in-place editing seam, computed server-side (mirror of
// ProofTreeComments.lean's TacticEdit): the TIGHT range of the tactic text
// proper (trailing trivia trimmed — Paperproof step ranges include it) and
// that text verbatim. Keyed by `start`, which equals the step's
// `position.start`.
interface TacticEditEntry {
  /** The STEP's own start — what this entry is keyed by. It differs from
  `start` only for a step Paperproof split out of a tactic (`rw [a, b]` is one
  step per rule), where the editable/colourable unit is the whole tactic. */
  stepStart: { line: number; character: number };
  start: { line: number; character: number };
  stop: { line: number; character: number };
  text: string;
  /** The server's semantic tokens for `text` — drives the label colouring. */
  tokens?: TacticToken[];
  /** Column where this step's line begins its tactic text — past the indent
  and past a bullet marker (see the Lean-side `tacticIndentAt`). What (+)
  insertions indent new sibling tactics by. */
  tacticIndent?: number;
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
  /** The declaration's diagnostics (ProofTreeWidget.lean `TreeDiag`), already
  in the client's `{start, stop}` span shape and already scoped to this
  command's own message log. In the PAYLOAD, not read off the
  `publishDiagnostics` notification: the notification is edge-triggered and a
  webview that loads after elaboration finishes never hears it — measured, a
  restart on the demo file reliably drew no ribbons until the next edit. */
  diagnostics?: RawDiagnostic[];
};

// The Lean infoview user-widget entry point. This is the default export bundled
// into `web/dist/proofTreeWidget.js` and loaded by `ProofTreeWidget`
// (lean/ProofTreeWidget.lean). It is the widget counterpart of App.tsx: instead
// of fetching NDJSON, it calls the `ProofTree.getProofTree` RPC for the theorem
// under the cursor and feeds the result to the shared ProofTreeView, wiring the
// two directions of the node↔source link (see below).

/** The editor theme's syntax colours, refreshed whenever the theme changes.
 *
 * The long way round is forced: a webview is given `--vscode-*` variables for
 * the workbench colour REGISTRY only, and TextMate/semantic token colours are
 * not in it — the extension API has no token-colour member at all. So the
 * companion resolves them from the active theme's JSON, and the Lean server
 * reads that file back to us (`ProofTree.themeColors`).
 *
 * The refresh trigger is the same signal the palette itself watches: VS Code
 * rewrites the CSS variables on the root element in place on a theme change.
 * The companion writes its file from its own listener, so the two race — hence
 * the second read shortly after. Both are a few hundred bytes.
 *
 * The file also carries SETTINGS (`brackets`, `outline`, `input`), and changing one of
 * those moves no CSS variable, so the observer alone would never see it. There
 * is no push channel here — a file written by an extension and read by the
 * server on demand — so the refetch rides three signals that cost nothing:
 * `tick` (the document revision, i.e. any re-elaboration), the webview
 * regaining focus, and the theme observer. Between them, a toggled setting
 * lands as soon as you type in the buffer or click the tree, without adding a
 * round trip per cursor move.
 */
function useThemeTokenColors(
  rs: ReturnType<typeof useRpcSession>,
  tick: number,
): {
  colors?: Record<string, string>;
  brackets: boolean;
  outline: boolean;
  tallFrame: boolean;
  linkEmoji: boolean;
  linkTint: boolean;
  linkMarks: boolean;
  typingHoldMs: number;
  abbrev: AbbrevConfig;
} {
  const [colors, setColors] = useState<Record<string, string>>();
  const [brackets, setBrackets] = useState(false);
  const [outline, setOutline] = useState(false);
  const [tallFrame, setTallFrame] = useState(false);
  const [linkEmoji, setLinkEmoji] = useState(false);
  const [linkTint, setLinkTint] = useState(false);
  // Defaults ON, unlike its two neighbours: absent means an older companion
  // that never knew the key, and the marks are what it was already drawing.
  const [linkMarks, setLinkMarks] = useState(true);
  // A NUMBER, unlike the rest of the wire's settings: absent or wrong-typed
  // falls back to the default hold, clamped so a stray settings.json value
  // can't park the tree for a minute.
  const [typingHoldMs, setTypingHoldMs] = useState(DEFAULT_TYPING_HOLD_MS);
  // vscode-lean4's own defaults until told otherwise, so the editor's unicode
  // input works with no companion installed — only a customised leader or a
  // custom translation needs this trip.
  const [abbrev, setAbbrev] = useState<AbbrevConfig>(DEFAULT_ABBREV);
  useEffect(() => {
    let live = true;
    const fetchOnce = () => {
      void rs
        .call<Record<string, never>, ThemeColorsResponse>(
          "ProofTree.themeColors",
          {},
        )
        .then((r) => {
          if (!live || !r) return;
          // The SETTINGS ride whatever came back, including the empty reply an
          // absent companion produces (whose defaults are the right answer);
          // only the PALETTE falls back to the built-in one when empty, since
          // there a missing value and "no companion" mean the same thing.
          setBrackets(!!r.brackets);
          setOutline(!!r.outline);
          setTallFrame(!!r.tallFrame);
          setLinkEmoji(!!r.linkEmoji);
          setLinkTint(!!r.linkTint);
          setLinkMarks(r.linkMarks !== false);
          setTypingHoldMs(
            typeof r.typingHoldMs === "number" && isFinite(r.typingHoldMs)
              ? Math.max(0, Math.min(Math.round(r.typingHoldMs), TYPING_HOLD_MAX_MS))
              : DEFAULT_TYPING_HOLD_MS,
          );
          if (r.input) {
            const next: AbbrevConfig = {
              enabled: r.input.enabled !== false,
              leader: r.input.leader || DEFAULT_ABBREV.leader,
              eager: r.input.eager !== false,
              custom: Object.fromEntries(
                (r.input.custom ?? []).map((c) => [c.abbreviation, c.symbol]),
              ),
            };
            // Identity-compared, because the config is a ProofTreeView PROP and
            // a fresh object every refetch would rebuild the editor's
            // abbreviation session mid-typing.
            setAbbrev((prev) =>
              JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
            );
          }
          if (!r.colors?.length) return;
          setColors(
            Object.fromEntries(r.colors.map((c) => [c.type, c.color])),
          );
        })
        .catch(() => {
          // No companion, no file, an older server: keep the built-in palette.
        });
    };
    fetchOnce();
    const stopObserving = observeThemeChange(() => {
      fetchOnce();
      window.setTimeout(fetchOnce, 400);
    });
    window.addEventListener("focus", fetchOnce);
    return () => {
      live = false;
      stopObserving();
      window.removeEventListener("focus", fetchOnce);
    };
  }, [rs, tick]);
  return {
    colors,
    brackets,
    outline,
    tallFrame,
    linkEmoji,
    linkTint,
    linkMarks,
    typingHoldMs,
    abbrev,
  };
}

/** `ProofTree.themeColors`'s reply (ProofTreeWidget.lean `ThemeColors`). */
interface ThemeColorsResponse {
  theme: string;
  /** `editor.bracketPairColorization.enabled` — a setting, so it cannot come
  from the `--vscode-*` variables the six bracket COLOURS do come from. */
  brackets: boolean;
  /** `proofTree.outlineOnly` — a setting, so it comes the same long way round. */
  outline: boolean;
  /** `proofTree.tallFrame` — ditto. Optional: an older companion's file has no
  such key, and a missing one means the default (leave the strip clear). */
  tallFrame?: boolean;
  /** `proofTree.linkEmoji` / `proofTree.linkTint` — the connector target-type
  marks' loud variants (emoji marks; edge ink tinted toward the target's hue).
  Optional for the same older-companion reason; missing means off. */
  linkEmoji?: boolean;
  linkTint?: boolean;
  linkMarks?: boolean;
  /** `proofTree.typingHoldMs` — the typing hold's quiet period (see
  DEFAULT_TYPING_HOLD_MS). Optional for the older-companion reason; missing
  means the default. */
  typingHoldMs?: number;
  /** `lean4.input.*` — settings again (ProofTreeWidget.lean `InputConfig`).
  Optional: an older companion's file simply has no such key. */
  input?: {
    enabled: boolean;
    leader: string;
    eager: boolean;
    custom: { abbreviation: string; symbol: string }[];
  };
  colors: { type: string; color: string }[];
}

export default function ProofTreeWidget(props: PanelWidgetProps) {
  const rs = useRpcSession();
  const ec = useContext(EditorContext);
  const pos = props.pos; // DocumentPosition: { uri, line, character }
  useSectionOrderCss();
  const { rootRef, offset } = useFrameOffset();
  // The panel's own fold (see the <details> at the end of this component).
  // Plain component state: the panel widget's React key is `widget::<id>::
  // <range>` — the `show_panel_widgets` command's span, not the cursor's — so
  // this component is NOT remounted as the cursor moves, and the fold survives
  // exactly as long as the infoview keeps showing this file's panel, which is
  // the same lifetime the infoview's own sections give their disclosure state.
  const [panelOpen, setPanelOpen] = useState(true);
  // The cursor is not the only thing that invalidates the tree: the DOCUMENT
  // changes too, and a change that leaves the cursor where it is (every edit
  // the widget itself makes via applyEdit — an in-place tactic commit, a (+)
  // insertion, a `sorry` stub — as well as any typing in the buffer or the
  // lens) would otherwise leave the old tree on screen until the cursor
  // happened to move. `publishDiagnostics` is the signal that the file worker
  // has re-elaborated and a fresh snapshot exists, which is exactly when a
  // re-parse can return something new; it is also what the infoview's own
  // panels refresh on. Bump a revision and let it ride the RPC's deps.
  //
  // Elaboration publishes diagnostics repeatedly as it progresses, so this
  // fires in bursts. That is affordable rather than ignored: the server caches
  // the whole payload on (uri, version, command start), and `stable` only
  // re-lays-out when the proof's TEXT signature actually changes — an
  // identical re-parse costs one cached round trip and no re-render of the
  // tree. A trailing debounce keeps even that down to one call per burst.
  //
  // The notification is ONLY the refresh signal — deliberately not the source
  // of the diagnostics the tree draws. It is edge-triggered, and a webview
  // subscribes only after it loads: whenever elaboration finished first (a
  // restart on a small file, reliably), no notification ever arrived and a
  // notification-fed ribbon drew nothing until the next edit. The diagnostics
  // ride the getProofTree PAYLOAD instead (level-triggered — they arrive with
  // every response, so the drawn errors can never be out of step with the
  // drawn tree); see `diagnostics` below and TreeDiag in ProofTreeWidget.lean.
  const [docRev, setDocRev] = useState(0);
  const revTimer = useRef<number | null>(null);
  useServerNotificationEffect<{ uri: string }>(
    "textDocument/publishDiagnostics",
    (params) => {
      if (params.uri !== pos.uri) return;
      if (revTimer.current !== null) window.clearTimeout(revTimer.current);
      revTimer.current = window.setTimeout(() => {
        revTimer.current = null;
        setDocRev((r) => r + 1);
      }, DOC_SETTLE_MS);
    },
    [pos.uri],
  );
  useEffect(
    () => () => {
      if (revTimer.current !== null) window.clearTimeout(revTimer.current);
    },
    [],
  );

  const {
    colors: tokenColors,
    brackets: colorBrackets,
    outline: outlineOnly,
    tallFrame,
    linkEmoji,
    linkTint,
    linkMarks,
    typingHoldMs,
    abbrev,
  } = useThemeTokenColors(rs, docRev);

  // Re-parse whenever the cursor moves; the server's snapshot is cached, so this
  // is cheap, and it is what makes the tree "follow the cursor". The server
  // returns an EMPTY proof (`steps: []`) when the cursor isn't inside a tactic
  // proof — that's a normal outcome, not an error (see getProofTree).
  const st = useAsyncPersistent<ProofTreeData>(
    () =>
      rs.call<{ pos: typeof pos }, ProofTreeData>("ProofTree.getProofTree", {
        pos,
      }),
    [rs, pos.uri, pos.line, pos.character, docRev],
  );

  // The latest non-empty response, if any. Both holders below key off it.
  const resolved =
    st.state === "resolved" && st.value.steps.length > 0 ? st.value : null;

  // Hold the last rendered NON-EMPTY proof, keyed by the payload's TEXT parts,
  // so re-highlighting on cursor moves within a proof doesn't churn the layout
  // or fold state, and moving the cursor out of the proof keeps the tree up.
  // Everything here is PLAIN DATA — no RPC references (see `interactive`).
  // We adjust this during render (React's sanctioned pattern, cf. `prevEngine`
  // in ProofTreeView) rather than via a ref, which mustn't be read during render.
  //
  // The signature serializes the whole proof, so it is memoized on the RESPONSE
  // object: `useAsyncPersistent` returns the same value identity between
  // renders, and un-memoized this ran O(payload) on every render — each hover,
  // zoom tick and editing keystroke — not just per response.
  const incoming = useMemo(() => {
    if (!resolved) return null;
    const proof: Proof = {
      steps: resolved.steps,
      allGoals: resolved.allGoals,
      comments: resolved.comments,
      // Plain data (positions + mvarIds), so it belongs in the stable half and
      // rides the signature: a hole filled or a link inserted moves the ranges,
      // and the chips must not keep pointing at where the `?_` used to be.
      holes: resolved.holes,
      calcChains: resolved.calcChains,
      // The supplemental parser's sidecar — plain data keyed on positions, and
      // it must ride the signature: whether a step is recovered changes how
      // its node draws, and a re-elaboration that fixes the tactic changes
      // exactly this.
      recovered: resolved.recovered,
      // Plain data too (relation SYMBOLS, not exprs), and it belongs in the
      // signature for the same reason: a changed relation list means the goal
      // itself changed, so the offer set must be recomputed with it.
      calcRelations: resolved.calcRelations,
      // The proof's identity, and part of the signature: moving the cursor to
      // a DIFFERENT theorem must invalidate the stable proof even if its text
      // somehow matched.
      proofId: resolved.proofId,
      // The declaration's own span, which `proofSpan` needs to decide which of
      // the FILE's diagnostics are this proof's. Both wires ship it and it must
      // be copied here: this object is rebuilt field by field, so a field left
      // out is silently absent rather than a type error, and without it
      // proofSpan falls back to the extent of the STEPS — which starts at the
      // first tactic and so drops every diagnostic reported above one.
      // `declaration uses 'sorry'` sits on the declaration NAME, so that is
      // exactly the warning it loses. It rides the signature for free: the
      // range moves whenever the declaration does.
      declRange: resolved.declRange,
      // NOT here, deliberately: `deleteSlots`. Both wires ship it (see
      // ProofTreeData and Ppharness's resultToJson) and `Proof` declares it
      // optional, so adding it would typecheck — but the widget carries it as
      // a SIBLING on `stable` below, and duplicating it here would give the
      // delete gesture two sources of truth that drift apart the moment one
      // is updated.
    };
    return { proof, sig: JSON.stringify(proof) };
  }, [resolved]);
  const [stable, setStable] = useState<{
    sig: string;
    proof: Proof;
    tacticEdits: TacticEditEntry[];
    deleteSlots: TacticSlot[];
  } | null>(null);
  // The full record a swap installs, memoized on the response so the typing
  // hold below re-arms once per payload, not once per render.
  const candidate = useMemo(
    () =>
      resolved && incoming
        ? {
            sig: incoming.sig,
            // `tacticNames` is attached HERE rather than in `incoming`, so it
            // stays out of `sig`: it is ~500 strings that depend only on the
            // imports, so stringifying them into every signature comparison
            // would be pure cost for a value that cannot change while the
            // file is open.
            proof: { ...incoming.proof, tacticNames: resolved.tacticNames },
            // Edits derive from the same source text as the steps, so
            // refreshing them exactly when the proof signature changes keeps
            // their ranges in sync with the document (positions live in the
            // steps → any shift changes the sig).
            tacticEdits: resolved.tacticEdits ?? [],
            // Same reasoning as the edits: slots are positions into the same
            // source text, so they refresh exactly when the proof's signature
            // does and can never describe a document the tree isn't showing.
            deleteSlots: resolved.deleteSlots ?? [],
          }
        : null,
    [resolved, incoming],
  );
  // Bypass window for the typing hold: written only by the widget's own
  // document writes (the applyEdit commits and the undo/redo relay), read
  // only inside the hold effect — never during render.
  const expectEditRef = useRef(0);
  // Immediate swap paths, adjusted during render as before: the first draw, a
  // DIFFERENT proof (the cursor moved theorems — holding a navigation would
  // read as latency, and the fold/zoom state resets on proofKey anyway), and
  // a zero hold (the setting's off switch, restoring swap-on-arrival).
  if (
    candidate &&
    (!stable ||
      (stable.sig !== candidate.sig &&
        (typingHoldMs <= 0 ||
          candidate.proof.proofId !== stable.proof.proofId)))
  ) {
    setStable(candidate);
  }
  // The TYPING HOLD. Same proof, new text is the shape of typing in the
  // buffer (or the lens): every keystroke that survives long enough to
  // elaborate lands a distinct text signature, and swapping each one in
  // relaid the tree out per keystroke — through the broken intermediates
  // (`ri` is a failed tactic), which is what the reported "shudder" was. So a
  // changed text must sit QUIET for `typingHoldMs` before it is installed.
  //
  // Two details carry the design. The timer re-arms on the SIGNATURE, not the
  // response object: elaboration settling down a long file bumps docRev
  // repeatedly, and each bump re-parses to a fresh but text-identical payload
  // — keying on identity would keep restarting the timer for the whole
  // file's elaboration, holding the tree for tens of seconds instead of one
  // quiet period. (The swap still installs the LATEST payload, via the ref
  // below.) And the widget's own edits bypass the hold through
  // `expectEditRef`, a time window rather than a consumed flag: the first
  // payload after an applyEdit can be a stale elaboration finishing, and a
  // one-shot flag spent on it would hold the real redraw.
  const candidateRef = useRef<typeof candidate>(null);
  useEffect(() => {
    candidateRef.current = candidate;
  });
  const candSig = candidate?.sig ?? null;
  const candProofId = candidate?.proof.proofId;
  useEffect(() => {
    if (candSig === null || !stable) return;
    if (stable.sig === candSig) return;
    // The render path above already took these cases.
    if (typingHoldMs <= 0 || candProofId !== stable.proof.proofId) return;
    const swap = () => {
      const c = candidateRef.current;
      if (c && c.sig === candSig) setStable(c);
    };
    if (Date.now() < expectEditRef.current) {
      swap();
      return;
    }
    const t = window.setTimeout(swap, typingHoldMs);
    return () => window.clearTimeout(t);
  }, [candSig, candProofId, stable, typingHoldMs]);

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
  const [interactive, setInteractive] = useState<ProofTreeData | null>(null);
  if (resolved && interactive !== resolved) {
    setInteractive(resolved);
  } else if (st.state === "rejected" && interactive !== null) {
    // A failed call is the one signal we get that the session may be gone;
    // holding its refs afterwards can only produce dead popups.
    setInteractive(null);
  }

  // The tagged (hover-interactive) label renderers for this proof; see
  // taggedRender.tsx.
  const renderers = useMemo(
    () =>
      stable
        ? makeTaggedRenderers(stable.proof, interactive?.taggedGoals ?? [])
        : null,
    [stable, interactive],
  );

  // This proof's diagnostics, from the LATEST response's payload (see
  // ProofTreeData.diagnostics for why they ride the payload and not the
  // notification). Filtering is here (the wire shape and the proof's own span
  // are widget-side facts) and ATTACHING is in the view, which is the half
  // that knows what is drawn — see `diagnostics.ts` for why the two split.
  //
  // Off `interactive`, not `stable`, on purpose: `stable` refreshes only when
  // the proof's TEXT changes, and diagnostics can change without it (a `sorry`
  // warning appearing as elaboration settles). They are plain data, so unlike
  // the ref-carrying halves nothing about session lifetime applies — riding
  // the latest response is just what keeps them current. The span filter still
  // runs against `stable`'s proof (the tree being drawn): a response from a
  // different theorem contributes nothing rather than the wrong theorem's
  // errors while `stable` holds the old tree on screen.
  const diagnostics: TreeDiagnostic[] = useMemo(
    () =>
      stable
        ? filterDiagnostics(
            interactive?.diagnostics ?? [],
            proofSpan(stable.proof),
          ).kept
        : [],
    [interactive, stable],
  );

  // Completion candidates for the in-place editor, drawn from the goal's own
  // tagged print — the SAME payload the hover tooltips use, so this costs one
  // tree walk and nothing on the wire. The goal's subterms come first (a `calc`
  // link restates part of its goal, which is the case that motivated this),
  // then each hypothesis's type.
  //
  // It lives here rather than in ProofTreeView because `taggedGoals` carries
  // live RPC refs and so belongs to the widget half; the view stays
  // source-agnostic and just receives strings.
  // The walk runs once per RESPONSE, not once per lookup. The lookup is called
  // from the editor's onChange/onSelect — once per keystroke — and the goal
  // being edited cannot change while you type into it, so walking on demand
  // re-derived the same subterm tree (and every hypothesis's) on every
  // character. Doing every goal eagerly costs more per response than the lazy
  // form did for one goal, and a response is once per EDIT (debounced, and
  // server-cached), which is the cheaper side to pay on.
  // The environment tier of the in-place editor's completion (see the view's
  // `fetchGlobalNames` prop and ProofTree.completionNames). The `pos` here
  // only picks the file-worker snapshot whose environment answers — any
  // position in the file serves, so the cursor's is fine — and the view owns
  // every gate (prefix length, debounce, cache, stale guard). Memoised on the
  // session and DOCUMENT only, deliberately not the cursor coordinates: any
  // in-file position serves (above), and this function's identity is a dep of
  // the view's debounce effect, so a per-cursor-move identity would cancel
  // and restart a pending fetch timer for nothing. The captured `pos` going
  // stale within the file is exactly the harmless case.
  const fetchGlobalNames = useMemo(
    () => (query: string) =>
      rs.call<{ pos: typeof pos; query: string }, string[]>(
        "ProofTree.completionNames",
        { pos, query },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rs, pos.uri],
  );

  const getGoalTerms = useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const { goalId, goal } of interactive?.taggedGoals ?? []) {
      const terms = taggedSubterms(goal.type);
      for (const h of goal.hyps) terms.push(...taggedSubterms(h.type));
      byId.set(goalId, terms);
    }
    return (goalId: string): string[] => byId.get(goalId) ?? [];
  }, [interactive]);

  // Every companion request rides this one call. `void rs.call(...)` used to
  // swallow rejections whole, which made a broken relay indistinguishable from
  // a dead button — the RPC can fail for real (no HOME, unwritable request
  // dir, a stale RPC session after the server restarts), and none of it
  // surfaced. Failures now land in the widget's own error banner AND the
  // webview console, so "nothing happened" always has a reason attached.
  const [relayError, setRelayError] = useState<string | null>(null);
  const callCompanion = (
    action: string,
    p: ProofStepPosition,
    annotations: GoalAnnotation[] = [],
  ) => {
    rs.call("ProofTree.popoutEdit", {
      uri: pos.uri,
      start: p.start,
      stop: p.stop,
      action,
      annotations,
    }).then(
      () => setRelayError(null),
      (e: unknown) => {
        console.error(`[proof-tree] ${action} RPC failed:`, e);
        // mapRpcError: the infoview's own RPC-error formatter (used for the
        // load-failure banner below) — no hand-rolled instanceof dance.
        setRelayError(`${action} failed: ${mapRpcError(e).message}`);
      },
    );
  };


  // In-place editing: resolve a step's tight edit seam (double-click opens
  // the editor overlay pre-filled with `text`)…
  const editByStart = useMemo(
    () =>
      new Map(
        (stable?.tacticEdits ?? []).map((e): [string, TacticEditEntry] => [
          // Keyed by the STEP, which is what a node's `position.start` is;
          // `start` may be the wider surface tactic (see TacticEditEntry).
          `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`,
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
        (interactive?.tokenInfos ?? []).map((i): [string, TacticTokenInfo] => [
          `${i.start.line}:${i.start.character}`,
          i,
        ]),
      ),
    [interactive],
  );

  // Built (with its internal result cache) exactly when its inputs refresh —
  // the same factory pattern as makeTaggedRenderers; see makeTacticRenderer
  // for why the cache exists.
  const renderTaggedTactic = useMemo(
    () =>
      makeTacticRenderer(
        (p) => editByStart.get(`${p.start.line}:${p.start.character}`),
        infoAt,
        colorBrackets,
      ),
    [editByStart, infoAt, colorBrackets],
  );

  // Every handler that writes the document stamps this before the write, so
  // the resulting re-elaboration bypasses the typing hold (see the hold
  // effect above): the user asked for this redraw, so it should be prompt.
  // Handler-phase only — writing a ref during render is the banned direction.
  const expectOwnEdit = () => {
    expectEditRef.current = Date.now() + EXPECT_EDIT_WINDOW_MS;
  };

  // …and commit by replacing the tight range in the document. Goes through
  // the editor's own edit pipeline (applyEdit), so it lands on the undo
  // stack and triggers re-elaboration; the tree redraws off the next RPC.
  // Comment edits and the flag writers route through here too, so one stamp
  // covers them.
  const editTactic = (p: ProofStepPosition, newText: string) => {
    expectOwnEdit();
    void ec.api.applyEdit({
      changes: { [pos.uri]: [{ range: { start: p.start, end: p.stop }, newText }] },
    });
  };

  // A (+) chip commit: INSERT a new tactic for a pending goal. The insertion
  // point is the end of the LINE holding the anchor step's TIGHT stop —
  // resolved through `tacticEdits` so trailing trivia can't push the anchor
  // onto the next tactic's line, and taken to end-of-line so a trailing
  // comment stays glued to its own tactic instead of jumping to the new line.
  // The huge character value is deliberate: positions beyond a line's end are
  // clamped by the editor when the edit applies, and the true line length
  // isn't known here (the widget never holds the document text).
  const addTactic = (
    spec: AddSpec,
    text: string,
    slots?: { lhs: TextSlot; rhs: TextSlot },
  ): AddResult => {
    expectOwnEdit();
    const at2 = (p: { line: number; character: number }) =>
      editByStart.get(`${p.line}:${p.character}`);
    // The `calc` forms act on a range of their own rather than on a line
    // anchor: `hole`/`calc-link` on the hole's, `calc-append`/`calc-first` on
    // the chain's last link (see calcEdit — kept pure and separate so a probe
    // can elaborate what it produces). Opening a chain is NOT one of them; it
    // is an ordinary line insertion, so it falls through below.
    const calc = calcEdit(spec, text);
    if (calc) {
      void ec.api.applyEdit({
        changes: { [pos.uri]: [{ range: calc.range, newText: calc.newText }] },
      });
      // Where the `sorry` this just wrote landed, so the view can open the
      // second half of the gesture on it (see calcEdit's STUB) — and, when the
      // edit left both ends of a link open, where those `_`s landed.
      const to = (s: TextSlot) =>
        offsetToPosition(calc.range.start, calc.newText, s.at, s.len);
      return {
        fill: calc.fillNth
          ? fillRange(calc.range.start, calc.newText, calc.fillNth)
          : null,
        stages: calc.stages
          ? { lhs: to(calc.stages.lhs), rhs: to(calc.stages.rhs) }
          : undefined,
      };
    }
    const e = at2(spec.after.start);
    const stop = e?.stop ?? spec.after.stop;
    const at = { line: stop.line, character: 1e5 };
    // Where the PRODUCER's line starts its tactic text, not `spec.indent`.
    // A step's start column lies whenever Paperproof split the tactic —
    // `rw [a, b]` is one step per rule, so the step for `b` starts at the rule
    // inside the brackets and indenting by its column put a new tactic 7
    // columns too deep. The bare line indent lies the other way on a bulleted
    // line (`  · constructor`), so the server measures past both (see
    // tacticIndentAt).
    const cols = at2(spec.producer.start)?.tacticIndent ?? spec.indent;
    const indent = " ".repeat(cols);
    const prefix =
      spec.kind === "bullet"
        ? "· "
        : spec.kind === "case"
          ? `| ${spec.caseName ?? "_"} => `
          : "";
    // Multi-line input: continuation lines sit one level inside the first
    // line's CONTENT, which is past the prefix — not past the bare indent.
    // With a `· ` bullet (or a `| case => ` marker) the two differ, and
    // indenting by the bare indent put a continuation at the very column its
    // own tactic starts at, so Lean read it as a sibling tactic:
    // `  · have h : p := by` / `    exact hp` fails with "expected '{' or
    // indented tactic sequence" (elaborated, not reasoned about).
    const inner = " ".repeat(indent.length + prefix.length + 2);
    const body = text
      .split("\n")
      .map((l, i) => (i === 0 ? indent + prefix + l : inner + l))
      .join("\n");
    const newText = "\n" + body;
    void ec.api.applyEdit({
      changes: { [pos.uri]: [{ range: { start: at, end: at }, newText }] },
    });
    // The `calc` opener is the one line-inserted text that carries a stub (the
    // view assembles it — see calcOpenText). Anything else has no `sorry` in
    // it, which fillRange reports as null — except the `sorry` CHIP, whose
    // whole point is to stop there, so it opts out explicitly.
    const start = { line: at.line, character: 0 };
    // Slots are offsets into `text`, which landed on the first line behind the
    // leading newline, the indent and any `· `/`| case => ` prefix — so shift
    // by exactly that much to index into `newText`.
    const lead = 1 + indent.length + prefix.length;
    const to = (s: TextSlot) =>
      offsetToPosition(start, newText, s.at + lead, s.len);
    return {
      fill: text === "sorry" ? null : fillRange(start, newText, 1),
      stages: slots ? { lhs: to(slots.lhs), rhs: to(slots.rhs) } : undefined,
    };
  };

  // Committing a delete. The extent maths lives in `deleteEdit` (pure, so a
  // probe can elaborate what it produces — the calcEdit precedent), and this
  // only applies the result through the editor's own pipeline, so it lands as
  // ONE undo entry like every other write here.
  const deleteTactic = (spec: DeleteSpec) => {
    const e = deleteEdit(spec, stable?.deleteSlots ?? []);
    if (!e) return;
    expectOwnEdit();
    void ec.api.applyEdit({
      changes: {
        [pos.uri]: [{ range: { start: e.range.start, end: e.range.end }, newText: e.newText }],
      },
    });
  };

  // The region an armed delete would take, painted in the buffer. NOT the
  // hover relay: the companion clamps that one to a single line, which is
  // right for "the tactic you are pointing at" and defeats this entirely.
  const previewRange = (r: ProofStepPosition | null) => {
    if (r) callCompanion("preview", r);
    else callCompanion("preview-clear", { start: ORIGIN, stop: ORIGIN });
  };

  // Undo/redo, relayed because the tree's own edits leave focus in the
  // webview where ⌘Z reaches nothing (see runEditorCommand in the companion —
  // it activates the editor group first, since undo acts on what is focused).
  const undo = (redo: boolean) => {
    // A document write like the applyEdit handlers (the companion runs the
    // editor's own undo), so it takes the same hold bypass.
    expectOwnEdit();
    callCompanion(redo ? "redo" : "undo", { start: ORIGIN, stop: ORIGIN });
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
      // The TIGHT range, not the node's own: a Paperproof step range includes
      // trailing trivia (it runs to the next tactic's first token), so
      // painting it bleeds past the tactic's text and onto the next line's
      // indent. `tacticEdits` already carries the server's trimmed span —
      // which also drops a trailing comment, something the companion's
      // geometric clamp can't see. It falls back to the node span for a
      // tactic that isn't in the edit map.
      callCompanion("highlight", getTacticEdit(p)?.pos ?? p);
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
  // Inline goal state for the lens, computed from the proof we are already
  // holding (see lensGoals.ts). It rides the popout itself — one payload per
  // gesture, no extra round trip — and is refreshed by the effect below.
  const lensGoals = useMemo(() => {
    if (!stable) return [];
    // A failed or never-ran tactic must not annotate its line: `∎` (both goal
    // lists empty) is exactly what a recovered leaf looks like, and it is a
    // lie there. Term-mode recovered steps stay in — a complete terminal term
    // really did close its goal.
    const recovered = new Set(
      (stable.proof.recovered ?? [])
        .filter((r) => r.kind !== "term")
        .map((r) => `${r.start.line}:${r.start.character}`),
    );
    const proof = recovered.size
      ? {
          ...stable.proof,
          steps: stable.proof.steps.filter(
            (s) =>
              !recovered.has(
                `${s.position.start.line}:${s.position.start.character}`,
              ),
          ),
        }
      : stable.proof;
    return goalAnnotations(
      proof,
      (start) => editByStart.get(`${start.line}:${start.character}`)?.stop,
    );
  }, [stable, editByStart]);
  // Declared BEFORE its readers: the React Compiler bails on a memo whose
  // closure references a binding declared later (the completion work hit this).
  const lensOpened = useRef(false);
  // tree→source: clicking a tactic node reveals its span in the editor —
  // routed through the COMPANION, not `ec.revealLocation`: vscode-lean4's
  // reveal targets the FIRST visible editor for the uri (always the main
  // buffer), while the companion targets the lens when one is open, which is
  // what closes the tree↔lens loop (the lens cursor move it causes flows
  // back as highlightPos). Without the companion installed, reveal is inert.
  // The TIGHT span again (see hoverTactic): a raw step range runs into the
  // next tactic, so revealing it would select past the tactic in the lens and,
  // for a structured tactic, select its whole block. The start is what matters
  // most — it becomes the cursor, and the accent lookup depends on it landing
  // at the range's start — and tightening never moves it.
  const reveal = (p: ProofStepPosition) =>
    // `lensGoals` rides along for the same reason `popout` sends it: the
    // companion re-paints the lens's inline goal state after a reveal, so
    // omitting it here published an EMPTY list and wiped the annotations on
    // every ⌘-click until some later edit happened to refire them.
    callCompanion("reveal", getTacticEdit(p)?.pos ?? p, lensGoals);

  const popoutEdit = (p: ProofStepPosition) => {
    lensOpened.current = true;
    callCompanion("popout", p, lensGoals);
  };
  // Annotations are POSITIONAL, so an edit invalidates every one below it. The
  // companion drops them on the first document change and waits for these; the
  // widget re-sends whenever the proof it is holding changes, which is exactly
  // when the lines could have moved. Gated on having opened a lens at least
  // once this session — otherwise every re-elaboration would write a relay file
  // for a pane that does not exist. The companion no-ops when no lens is found,
  // so a closed lens costs one file write per edit burst and nothing more.
  useEffect(() => {
    if (!lensOpened.current || lensGoals.length === 0) return;
    callCompanion("annotate", { start: ORIGIN, stop: ORIGIN }, lensGoals);
    // callCompanion is re-created every render; the payload is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensGoals]);

  // Until a proof has rendered, surface the three transient states: a genuine
  // RPC failure, the empty "not in a proof" result, or still loading. Once a
  // tree is up, all three quietly keep the last proof on screen instead.
  const body = !stable ? (
    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888", padding: 4 }}>
      {st.state === "rejected"
        ? `Proof tree error: ${mapRpcError(st.error).message}`
        : st.state === "resolved"
          ? "No proof tree here — place the cursor inside a tactic proof."
          : "Loading proof tree…"}
    </div>
  ) : (
    // `rootRef` measures the TREE's top, so it goes below the summary — a ref
    // on the outer element would report the section's top and the frame would
    // overhang the fold by exactly the height of the disclosure line.
    <div ref={rootRef}>
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
        getGoalTerms={getGoalTerms}
        fetchGlobalNames={fetchGlobalNames}
        tokenColors={tokenColors}
        outline={outlineOnly}
        linkEmoji={linkEmoji}
        linkTint={linkTint}
        linkMarks={linkMarks}
        abbrev={abbrev}
        onPopoutEdit={popoutEdit}
        highlightPos={{ line: pos.line, character: pos.character }}
        // The room below our own top (see useFrameOffset — NOT a flat 100vh,
        // which overhangs by exactly that offset), less the deliberate strip
        // kept clear at the bottom. `max(…)` is the transient-measurement
        // floor. Left as CSS rather than resolved here on purpose: a webview
        // that is hidden when the panel is resized fires neither observer nor
        // resize handler, and a px height computed at the last measurement
        // would stay wrong until something else moved — the units re-resolve
        // on their own.
        height={`max(${MIN_FRAME_PX}px, calc((100vh - ${offset}px) * ${
          tallFrame ? FRAME_FRACTION_TALL : FRAME_FRACTION
        }))`}
        renderTaggedGoal={renderers?.renderTaggedGoal}
        renderTaggedHyps={renderers?.renderTaggedHyps}
        renderTaggedTactic={renderTaggedTactic}
        onAddTactic={addTactic}
        onHoverTactic={hoverTactic}
        deleteSlots={stable?.deleteSlots}
        onDeleteTactic={deleteTactic}
        onPreviewRange={previewRange}
        onUndo={undo}
        diagnostics={diagnostics}
      />
    </div>
  );

  // The panel folds like the infoview's own sections, and the disclosure has to
  // be OURS: the infoview wraps a widget in <details> only when the instance
  // carries `name?`, and core fills that field for the DEPRECATED
  // `UserWidgetDefinition` form alone (Lean/Widget/UserWidget.lean's
  // `getWidgets` — the `.filter (·.type.isConstOf ``UserWidgetDefinition)`),
  // never for a ProofWidgets `Component`. So the wrapper this widget gets is no
  // wrapper at all; SECTION_ORDER_CSS's summary rule covers only the case where
  // one appears. Same markup and utility classes as "Tactic state" above it, so
  // it reads as a sibling section rather than as the tree growing its own bar.
  //
  // Folding must not UNMOUNT the tree: fold, zoom, scroll, focus and elide
  // state all live in ProofTreeView, and a disclosure that reset the view every
  // time it was closed would cost far more than the line of chrome it buys.
  // `<details>` hides its content without removing it, so the subtree keeps
  // its state — and `data-ptw-root` keeps its slot in the section order, which
  // is why the attribute sits on the wrapper rather than on the content: when
  // collapsed the content is invisible to layout, and a `:has()` rule anchored
  // on it would stop matching and drop the collapsed section back among the
  // volatile blocks it was ordered above.
  return (
    <div data-ptw-root style={{ marginTop: "0.25rem" }}>
      <details
        open={panelOpen}
        // `onToggle`, not a click handler on the summary: the browser owns this
        // state, and this way the keyboard (Enter/Space on a focused summary)
        // goes through the same path as the pointer.
        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
      >
        <summary className="mv2 pointer">Proof tree</summary>
        {body}
      </details>
    </div>
  );
}
