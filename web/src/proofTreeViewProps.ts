// The view's props: every hook a host (widget.tsx, App.tsx, viewer.tsx,
// playground.tsx) may pass. Split out of ProofTreeView.tsx, unchanged.
import type { ReactNode } from "react";
import type { AbbrevConfig } from "./abbreviation";
import type {
  AutomationTrace,
  Proof,
  ProofStepPosition,
  TacticSlot,
} from "./paperproof";
import type { Experience } from "./experience";
import type { BarKind, MoveId } from "./moves";
import type {
  AddResult,
  AddSpec,
  DeleteSpec,
  TextSlot,
  TreeNode,
} from "./types";
import type { Rewrite, RewriteEdit, Pos as RewritePos } from "./rewrite";
import type { TreeDiagnostic } from "./diagnostics";
import type { SearchSuggestion } from "./searchFix";
import type { Lint } from "./lints";
import type { HypMode } from "./proofToTree";
import type { HypMarkStyle } from "./theme";
import type { PolishLine } from "./narrate";
import type { KeepSeg } from "./briefLabel";
import type { CommentMode, LayoutMode } from "./viewModes";
import type { RestartInfo } from "./statusBar";
import type { SettingId, ViewSettings } from "./viewSettings";

export interface ProofTreeViewProps {
  proof: Proof;

  onReveal?: (pos: ProofStepPosition) => void;

  getTacticEdit?: (pos: ProofStepPosition) => {
    pos: ProofStepPosition;
    text: string;
    /** D1 — the column the tactic's own line starts it at, which is where a
     hoisted `have` goes and what an inlined block is re-indented under. */
    indent?: number;
  } | null;

  onEditTactic?: (pos: ProofStepPosition, newText: string) => void;

  getGoalTerms?: (goalId: string) => string[];

  fetchGlobalNames?: (query: string) => Promise<string[]>;

  tokenColors?: Record<string, string>;

  outline?: boolean;

  hypMarkStyle?: HypMarkStyle;

  linkTint?: boolean;
  linkMarks?: boolean;

  onPopoutEdit?: (pos: ProofStepPosition) => void;

  highlightPos?: { line: number; character: number } | null;

  declHeader?: string;
  /** Where `declHeader` starts in the source, and the two positions the
   positions the server found in it by syntax KIND (paperproof.ts): the
   signature's start (the name ends there), the type spec's `:` (binders end
   there) and the body's `:=`/`|`/`where` (the whole signature ends there).
   The resting header is the LONGEST of those cuts that fits on one line.
   Absent → the header falls back to its first source line. */
  declHeaderStart?: { line: number; character: number };
  declHeaderNameStop?: { line: number; character: number };
  declHeaderSigStop?: { line: number; character: number };
  declHeaderBodyStop?: { line: number; character: number };

  renderDeclHeader?: (
    lines: string[],

    label?: string,
    /** A label that is not the source verbatim (the collapsed one-line rest
     text) maps back to source offsets through this. */
    elision?: { original: string; keep: KeepSeg[]; marks: [] },
  ) => ReactNode[] | null;

  onRevealHeader?: () => void;
  cfStub?: {
    line: number;
    pos?: { line: number; character: number };
    draft: string;
    col?: number;

    render?: (draft: string, line: number, col: number) => ReactNode[] | null;
  } | null;

  headerExtra?: ReactNode;

  height?: string | number;

  renderTaggedGoal?: (
    goalId: string,
    lines: string[],
    hiddenLhs?: string,

    prefix?: string,
  ) => ReactNode[] | null;

  renderTaggedHyps?: (
    goalId: string,
    lines: string[],
  ) => (ReactNode | null)[] | null;

  renderTaggedTactic?: (
    pos: ProofStepPosition,
    label: string,
    lines: string[],
    elision?: TreeNode["elision"],
  ) => ReactNode[] | null;

  onAddTactic?: (
    spec: AddSpec,
    text: string,
    slots?: { lhs: TextSlot; rhs: TextSlot },
  ) => AddResult | null | void;

  deleteSlots?: TacticSlot[];

  /** THE PLAYGROUND (playground.tsx) — try a tactic under an OPEN goal and let
      the host answer it; nothing is written anywhere. The frontier next-tactic slot
      opens the same in-place editor `onAddTactic`'s does, and its commit hands
      the goal's id and the typed text here. Narrower than `onAddTactic` by
      construction: only the next-tactic slot is offered (no `sorry`, `calc` or
      `step`, which write source), on a goal with an `addSpec`; the `play`
      capability gates its `?` row. */
  onTryTactic?: (goalId: string, text: string) => void;
  /** The editor's completion list for one goal (the playground: what is baked
      under it). Absent, the list is `proof.tacticNames`. */
  getGoalTactics?: (goalId: string) => string[];

  /** B4 — the automation traces already in hand. In the WIDGET this is the
      RPC's answers, held by the caller and passed as a sibling (the payload
      does not carry them: a proof with ten `simp`s must not re-elaborate on
      every cursor move); offline it falls back to `proof.automationTraces`,
      which `ppharness --traces` puts on the wire. */
  automationTraces?: AutomationTrace[];

  /** Ask for one step's trace. Resolving with `false` means the server said
      nothing useful and the reader should be told; absent, the affordance is
      offered only where a trace is already in hand (the harness). */
  onTrace?: (pos: ProofStepPosition) => Promise<boolean>;

  /** The text signature the held traces are OUT OF DATE against (an edit
      landed since they were read), else null. While a trace is open — the
      reader's `⁇` or the beginner preset's auto-open — the view re-asks
      through `onTrace`, once per signature; with none open nothing is
      asked, so an edit pause costs no re-elaboration. */
  automationTracesStaleVer?: string | null;

  ledger?: boolean;

  onDeleteTactic?: (spec: DeleteSpec) => void;

  /** D1 — ask the ELABORATOR whether a candidate rewrite still checks
      (`ProofTree.checkRewrite`). Nothing is written: the edits are applied to
      a copy of the file's text and the declaration re-elaborated through the
      cf seam. Absent (the harness) the proposal is shown with a stubbed ✓ so
      the gesture can still be seen. */
  onCheckRewrite?: (edits: RewriteEdit[]) => Promise<{
    verdict: string;
    ok: boolean;
    message?: string;
    steps: number;
    before: number;
  }>;

  /** D2a — ask the elaborator whether ONE automation tactic closes a linear
      run (`ProofTree.tryClose`). The run is named by its first and last
      step's start; the server splices the run's own extent and tries each
      candidate in order. Absent (the harness) the offer is stubbed with the
      first candidate so the gesture and the pill can still be seen. */
  onTryClose?: (
    from: { line: number; character: number },
    to: { line: number; character: number },
  ) => Promise<{
    tactic?: string;
    verdict: string;
    message?: string;
    tried?: string[];
    before?: number;
    steps?: number;
  }>;

  /** D1 — write an ACCEPTED rewrite, through the one `applyEdit` every other
      write goes through. Every intermediate state is a valid file and the
      editor's own undo takes it back. `renameAt` is an extract's `this`
      binder in the WRITTEN text: the widget follows the write with the
      companion's Rename Symbol there (best-effort — the write never waits on
      it, and without a companion nothing more happens). */
  onApplyRewrite?: (edits: RewriteEdit[], renameAt?: RewritePos) => void;

  /** C4 — LLM POLISH of the templated narration, through the companion. The
      widget cannot reach the network; the companion can, so the view hands it
      the templated lines and is handed sentences back. Absent, or with
      `polishReady` false, the `polish` row is NOT DRAWN (2026-09-22: a
      reader with no key should not meet a feature that needs one). */
  onPolish?: (
    lines: PolishLine[],
  ) => Promise<{ nodeId: string; text: string }[]>;
  /** Is there a companion with an API key behind `onPolish`? */
  polishReady?: boolean;
  /** The `ramify.narration.polish` setting — the SESSION's default, which the
      row then overrides for this session alone. */
  polishDefault?: boolean;

  /** `ramify.experience` (experience.ts): fills the DEFAULTS of the hover
      bar's buttons, the cursor's automation trace, the `⇓` offer, and the
      lints/comments/context/brief rows. Each row the reader changes is a
      session OVERRIDE and wins. Absent: intermediate. */
  experience?: Experience;

  /** `ramify.hoverBar.tactic` / `.goal` — the hover bar's buttons per node
      kind, in order, where the reader SET them (the companion sends a list
      only when `inspect()` finds one; the harness takes `?hoverbar-tactic=`).
      Absent, the preset's list stands. A pin in the `⋯` menu wins over both
      for the session and calls `onHoverBarChange` so the setting follows. */
  hoverBar?: {
    tactic?: readonly MoveId[] | null;
    goal?: readonly MoveId[] | null;
  };
  onHoverBarChange?: (kind: BarKind, ids: MoveId[]) => void;

  /** The SETTINGS BEHIND THE BAND (viewSettings.ts, batch 5): `ramify.view.*`,
      `ramify.reading.*`, `ramify.diagnostics.autoOpen`, each present only
      where the reader SET it. Each row's default is the setting, else the
      preset's, else the view's own; the row the reader changes is a session
      override on top (`useOverride`). */
  settings?: ViewSettings;
  /** Persist a band / panel change: the widget asks the companion to write
      `ramify.<key>` (`popoutEdit` action `setting`). Absent (no companion,
      the static viewer) a change is session-only, as before. */
  onSettingChange?: (id: SettingId, value: string | number | boolean) => void;
  /** RESTART FILE (2026-10-05): the band's rightmost item, where the host can
      restart the file (the widget: `ec.api.restartFile`). Absent (the
      harness without `?restart-stub`, the static viewer), no item, and the
      host's own button is left alone. */
  restart?: RestartInfo;

  /** D6 — ASK AN AGENT to choose among the rewrites the primitives already
      offer. The view hands over the offered rewrites (never free text) and is
      handed back one node id, one kind and a one-line reason; the choice then
      goes through `onCheckRewrite` like every other proposal. */
  onPropose?: (req: {
    text: string;
    primitives: { nodeId: string; kind: Rewrite["kind"]; title: string }[];
  }) => Promise<{
    nodeId?: string;
    kind?: string;
    reason?: string;
    note?: string;
  }>;
  /** Is `ramify.restructure.propose` on, with a companion and a key behind it?
      False, the `suggest a rewrite` row is not drawn. */
  proposeReady?: boolean;

  onPreviewRange?: (range: ProofStepPosition | null) => void;

  /** The undo relay. What only the Ramify extension can do — this, the lens
      (`onPopoutEdit`), the hover highlight and the range previews — is passed
      only where the extension is there: absent, the lens is gone from the bar
      and the `⋯` menu, and ⌘Z says why instead of nothing. */
  onUndo?: (redo: boolean) => void;

  onHoverTactic?: (pos: ProofStepPosition | null) => void;

  abbrev?: AbbrevConfig;

  diagnostics?: TreeDiagnostic[];

  /** H6 — what `exact?`/`apply?`/`rw?` found: the `Try this` info messages
      (which `filterDiagnostics` drops), one line each. The view offers each as
      the expand move on its step, checked by `checkRewrite` like any rewrite. */
  searchSuggestions?: SearchSuggestion[];

  /** D4 — Mathlib's own style linters for THIS declaration. In the widget
      they arrive from `ProofTree.lintDecl` (a re-elaboration, so it is fired
      only when the reader asks) and are passed as a SIBLING; offline they fall
      back to `proof.lints`, which `ppharness --lint` puts on the wire. The
      `deleteSlots` rule, said again: read the argument, fall back to the
      field. */
  lints?: Lint[];

  /** Tell the caller the `lints` reading option went on or off. Turning it ON
      is what asks the server; nothing here fires it unasked. Absent (the
      harness) the option simply draws whatever `lints` already holds. */
  onLints?: (on: boolean) => void;

  /** The reading state to START in, where a caller has one to restore (the
      static viewer's deep links): the layout, the context mode and the
      comment mode. Each is the DEFAULT of the same session state the status
      bar changes (`useOverride`), ahead of the setting and the preset, so the
      reader's own choice wins over it and a caller that follows the reader
      (the viewer's hash, via `onViewState`) only moves it to what is shown.
      Absent, the defaults (the setting, else outline / the preset's). */
  initialView?: {
    layout?: LayoutMode;
    context?: HypMode;
    comments?: CommentMode;
  };

  /** THE TARGET GOAL — the open goal the host is addressing (the
      playground: the goal its goal panel shows and its caret writes under).
      That goal's box wears a plain 2px border in `--ptw-focus`. Paint only:
      no relayout, nothing reserved, and nothing drawn when the id is not on
      screen. Absent or null, no box is marked. */
  targetGoalId?: string | null;

  /** CLOSING MARKS — every tactic that closes its goal (no goal after it in
      the base tree; not a failed or recovered step, not `sorry`) wears a
      tombstone `∎` after its last line in `--ptw-closed`. The layout reserves
      its width (`closedMarks`, layout.ts), so it overlaps nothing. Off by
      default (the probes' fingerprint reads the defaults, and so does the
      harness); the widget, the viewer and the playground turn it on. */
  closedMarks?: boolean;

  /** Draw the ACCENT on the node the cursor (`highlightPos`) or a click
      picked. Default true. False keeps everything else the cursor does —
      following, peeking — and drops only the accent stroke (the playground:
      once the proof is complete, the last step need not stay lit). A
      marquee selection still accents. */
  cursorAccent?: boolean;

  /** The zoom to START at (and to return to on a proof with no stash). The
      rail's steps are ×1.25. Default 1. */
  initialZoom?: number;

  /** OFF-MAP goals — open goals the host cannot answer past (the
      playground: a state the bake never explored). Each is drawn DASHED and
      at `STUB_OPACITY`, the stub idiom, and its `<title>` says why. Paint
      only: no relayout, nothing reserved. Default empty. */
  offMapGoalIds?: ReadonlySet<string>;
  /** The `<title>` line an off-map goal carries. */
  offMapNote?: string;

  /** Draw the SIGNATURE HEADER from `declHeader`. Default true. False (the
      playground, whose editor already shows the signature) keeps the header
      text for what reads it — the status readout still omits the name — and
      draws no header band. */
  signatureHeader?: boolean;

  /** Told the three `initialView` values whenever one changes, so a caller
      can keep a shareable link in step (the viewer writes its URL hash). */
  onViewState?: (s: {
    layout: LayoutMode;
    context: HypMode;
    comments: CommentMode;
  }) => void;
}
