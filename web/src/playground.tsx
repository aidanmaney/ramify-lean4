// THE PLAYGROUND — write a proof as Lean text beside its tree, with no server.
//
// `lean/PlaygroundBake.lean` ran every (goal, tactic) answer a visitor is
// likely to ask for through real Lean, once, and `scripts/publish.mjs
// --playground` ships one table per theorem (`playground/<name>.json`). The
// opt-in LIVE tier (playgroundLive.ts) answers the rest with Lean compiled to
// WebAssembly, in the same shape. Everything a visitor sees — goals, errors,
// hovers — is what Lean said.
//
//   editor text ──replayText()──▶ attempts ──buildProof()──▶ records ──▶ ProofTreeView
//              (playgroundText.ts: Lean's block rules; play() per tactic: table, then live)
//
// The TEXT is the source of truth (playgroundEditor.tsx): every gesture the
// tree offers here is an edit to it — the `+` chip and the goal panel's
// hints through an open goal's anchor, double-click and the trash over a
// step's real range, the Quick Fixes through `onApplyRewrite`, ⌘Z as the
// editor's undo. The view is otherwise the static viewer's (BakedCode,
// BakedPopups, viewerTheme); Lean-only moves stay absent through
// `caps`/`availability`. docs/viewer.md "The playground".
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ProofTreeView from "./ProofTreeView";
import { BakedCode } from "./bakedCode";
import { BakedPopups } from "./bakedPopups";
import { filterDiagnostics, proofSpan } from "./diagnostics";
import { WidgetBoundary } from "./errorBoundary";
import { parseAppearance } from "./appearance";
import { parseExperience } from "./experience";
import type { DeleteSpec } from "./types";
import type { ProofStepPosition } from "./paperproof";
import { deleteEdit } from "./deleteEdit";
import type { RewriteEdit } from "./rewrite";
import {
  bakedEngine,
  buildProof,
  checkBake,
  completions,
  loadTable,
  rankedCompletions,
  makeAnswer,
  renameWords,
  type BakedGoal,
  type Built,
  type OpenGoal,
  type Table,
} from "./playgroundAnswer";
import { PlaygroundEditor, type EditorHandle } from "./playgroundEditor";
import { isInaccessible, isUnnamedSplit, nameCasesText } from "./nameCases";
import { freshDoc, replayText, type PlayCache, type TextRun } from "./playgroundText";
import { Codicon } from "./codiconView";
import { DIAG_ICON, type Severity } from "./diagInk";
import { daggerHtml } from "./dagger";
import { ICON } from "./icons";
import { formatLink, parseLink, type ViewerLink } from "./viewerLink";
import { LiveLean, liveEngine, liveHints, type LiveStatus } from "./playgroundLive";
import { injectStyleOnce, makeTaggedRenderersWith } from "./taggedCore";
import type { TaggedText } from "./taggedText";
import {
  CHROME_BORDER,
  CHROME_FONT,
  CHROME_INK,
  CHROME_RADIUS,
  CHROME_TEXT,
  CHROME_TEXT_SM,
  DIM_OPACITY,
  DISABLED_OPACITY,
  chromeScopeProps,
  type ThemeKind,
} from "./theme";
import { useNarrow, useTheme } from "./viewerHooks";
import type { BakedTag } from "./viewerPayload";
import { TOKEN_PALETTE } from "./viewerTheme";

const QUERY = new URLSearchParams(location.search);
const EXPERIENCE = parseExperience(QUERY.get("experience"));
// `?appearance=classic`: the classic skin, as the viewer's link takes it (the
// Layout panel's `classic look` row is the session's switch either way).
const APPEARANCE = parseAppearance(QUERY.get("appearance") ?? undefined);
/** Per-browser conveniences (localStorage can throw or be empty: never relied on). */
const stored = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private window: session only */
  }
};
/** The opt-in live tier (playgroundLive.ts): ONE wasm Lean per page, started
 by the reader. `?live=<base>` points it elsewhere (a dev server). */
const LIVE = new LiveLean(QUERY.get("live") ?? "live/");
// Turning live Lean on is the ONE opt-in (the download); there is no off.
// After it, it starts by itself on every visit: the reader's word is kept in
// localStorage, and — since that can be cleared or blocked — the worker's own
// Cache Storage holding the files counts as the same word (no download then).
const LIVE_KEY = "ramify.playground.live";
const LIVE_CACHE = "ramify-live-v1"; // scripts/wasm/playground-worker.js
LIVE.subscribe((st) => {
  if (st.kind === "ready") store(LIVE_KEY, "on");
});
// `probed`: whether that check is over — the arrival notice waits for it, or
// it would flash on a visit where Lean is about to start from the cache.
let probed = false;
const probeListeners = new Set<() => void>();
const useProbed = (): boolean =>
  useSyncExternalStore(
    (f) => (probeListeners.add(f), () => probeListeners.delete(f)),
    () => probed,
  );
if (stored(LIVE_KEY) === "on") LIVE.start();
void (async () => {
  try {
    if (LIVE.status.kind === "off" && (await caches.has(LIVE_CACHE))) {
      const held = await (await caches.open(LIVE_CACHE)).keys();
      if (held.length > 0 && LIVE.status.kind === "off") LIVE.start();
    }
  } catch {
    /* no Cache Storage (a private window): the reader starts it */
  }
  probed = true;
  probeListeners.forEach((f) => f());
})();
const useLiveStatus = (): LiveStatus =>
  useSyncExternalStore(
    (f) => LIVE.subscribe(f),
    () => LIVE.status,
  );
const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`;

/** What the header SHOWS, paced for reading: from the cache the steps go by
 in a few hundred ms, too fast to read, so each loading step stays up at
 least STEP_MIN_MS and "ready" then stands READY_MS before the label goes.
 Display only — Lean answers the moment it is ready; a progress update within
 the shown step (the MB count) and `off`/`failed` show at once. */
const STEP_MIN_MS = 500;
const READY_MS = 1000;
type Shown = LiveStatus | { kind: "gone" };
const shown = {
  now: LIVE.status as Shown,
  since: Date.now(), // a start at load ("starting") is a step to read too
  queue: [] as Shown[],
  timer: 0 as ReturnType<typeof setTimeout> | 0,
  fs: new Set<() => void>(),
};
function showNext() {
  shown.timer = 0;
  const hold =
    shown.now.kind === "loading" ? STEP_MIN_MS : shown.now.kind === "ready" ? READY_MS : 0;
  const wait = shown.since + hold - Date.now();
  if (wait > 0) {
    shown.timer = setTimeout(showNext, wait);
    return;
  }
  const next = shown.queue.shift() ?? (shown.now.kind === "ready" ? { kind: "gone" as const } : null);
  if (!next) return;
  shown.now = next;
  shown.since = Date.now();
  shown.fs.forEach((f) => f());
  if (shown.queue.length > 0 || next.kind === "ready") shown.timer = setTimeout(showNext, 0);
}
LIVE.subscribe((st) => {
  const last = shown.queue.at(-1) ?? shown.now;
  if (st.kind === "off" || st.kind === "failed") {
    // at once: nothing to read, and a retry should not wait
    clearTimeout(shown.timer);
    shown.queue = [];
    shown.now = st;
    shown.since = Date.now();
    shown.fs.forEach((f) => f());
    return;
  }
  if (st.kind === "loading" && last.kind === "loading" && last.step === st.step) {
    if (shown.queue.length > 0) shown.queue[shown.queue.length - 1] = st;
    else {
      shown.now = st;
      shown.fs.forEach((f) => f());
    }
    return;
  }
  shown.queue.push(st);
  if (!shown.timer) showNext();
});
const useShownStatus = (): Shown =>
  useSyncExternalStore(
    (f) => (shown.fs.add(f), () => shown.fs.delete(f)),
    () => shown.now,
  );

/** Live Lean needs cross-origin isolation for its threads, which GitHub Pages
 cannot give (no COOP/COEP headers): there the page offers only the baked
 answers, and nothing names a button that is not drawn. */
const LIVE_OFFERED = !!globalThis.crossOriginIsolated;

/** The header's switch for the live tier: off → loading → ready → gone. Once
 Lean runs there is nothing to switch — nobody turns it off — so after a brief
 "ready" the header says nothing more (failed keeps a retry). */
function LiveButton() {
  const st = useShownStatus();
  if (!LIVE_OFFERED) return null;
  if (st.kind === "gone") return null;
  if (st.kind === "ready")
    return (
      <span className="ptw-pg-dim" role="status">
        Live Lean: ready
      </span>
    );
  if (st.kind === "loading")
    return (
      <span className="ptw-pg-dim" role="status">
        Live Lean: {st.step}
        {st.done !== undefined ? ` ${mb(st.done)}${st.total ? ` / ${mb(st.total)}` : ""}` : ""}…
      </span>
    );
  return (
    <button
      type="button"
      className="ptw-pg-quiet"
      title={
        st.kind === "failed"
          ? `Live Lean did not start: ${st.why} — click to try again`
          : "Download Lean compiled to WebAssembly (about 35 MB once, desktop browsers) so any tactic is checked by Lean in this tab, not only the ones computed in advance"
      }
      onClick={() => LIVE.start()}
    >
      {st.kind === "failed" ? "Live Lean failed — retry" : "Run real Lean"}
    </button>
  );
}

/** A reader who said "Don't show again" (or who once turned live Lean off
 themselves) is not asked on later visits. */
const NOTICE_KEY = "ramify.playground.liveNotice";

/** The OFFER of the live tier — one quiet line at the foot of the goal
 panel, covering nothing (it was a notification over the tree's top right).
 Only while live Lean is off, never once the reader has decided (turned it
 on, or "Don't show again"), and not where it cannot run (no cross-origin
 isolation). */
function LiveOffer() {
  const st = useLiveStatus();
  const ready = useProbed();
  const [hidden, setHidden] = useState(
    () =>
      stored(NOTICE_KEY) === "never" ||
      stored(LIVE_KEY) === "on" ||
      !LIVE_OFFERED,
  );
  if (hidden || !ready || st.kind !== "off") return null;
  return (
    <div className="ptw-pg-offer ptw-pg-dim">
      <button
        type="button"
        className="ptw-pg-quiet ptw-pg-linkish"
        onClick={() => LIVE.start()}
        title="The answers here were worked out in advance for the steps each demo expects. Run Lean in this tab and anything you type gets Lean's own answer. Desktop browsers"
      >
        Check any tactic with real Lean (35 MB, once)
      </button>
      <button
        type="button"
        className="ptw-pg-quiet"
        onClick={() => {
          store(NOTICE_KEY, "never");
          setHidden(true);
        }}
      >
        Don&rsquo;t show again
      </button>
    </div>
  );
}

const RELEASE_URL ="https://github.com/aidanmaney/ramify-lean4/releases/latest";
const NARROW_PX = 700;
/** Where the reader starts: `wide`, so the tree fills the pane, and the
 context `diff` — each case box shows only what it gained (the view's `used`
 default shows what the next step used, and an open goal has no next step
 yet; `all` repeated `n : Nat` in every box). One rail zoom step in. The
 reader's own layout / context / comments ride the hash beside `t=` (the
 static viewer's words, viewerLink.ts) and win over these on a reload. */
const START_VIEW = { layout: "wide", context: "delta" } as const;
const START_ZOOM = 1.25;
type ViewWords = Pick<ViewerLink, "layout" | "context" | "comments">;
/** The reader's view words, as the hash carries them (an external system). */
const viewWords: { now: ViewWords } = { now: viewWordsOf(location.hash) };
function viewWordsOf(hash: string): ViewWords {
  const l = parseLink(hash);
  return { layout: l.layout, context: l.context, comments: l.comments };
}
/** The hash for theorem `t`: `t=` and only the view words that differ from
 where the page starts, so a plain link stays `#t=Name`. */
function hashFor(t: string): string {
  const w = viewWords.now;
  const rest = formatLink({
    layout: w.layout !== START_VIEW.layout ? w.layout : undefined,
    context: w.context !== START_VIEW.context ? w.context : undefined,
    comments: w.comments !== "shown" ? w.comments : undefined,
  }).slice(1);
  return `#t=${encodeURIComponent(t)}${rest ? `&${rest}` : ""}`;
}
const OFF_MAP_NOTE = "Not explored in this demo — Undo to go back";

/** `playground/index.json`: the theorems, in the list's order. */
interface Entry {
  name: string;
  theorem: string;
  title: string;
  blurb: string;
  statement: string;
}

const PAGE_CSS = `
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: ${CHROME_FONT};
}
.ptw-pg { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ptw-pg-head {
  display: flex; align-items: center; gap: 10px; white-space: nowrap; flex-wrap: wrap;
  padding: 6px 12px; min-width: 0; border-bottom: 1px solid ${CHROME_BORDER};
  font-size: ${CHROME_TEXT}px; color: ${CHROME_INK};
}
.ptw-pg button, .ptw-pg select, .ptw-pg input {
  font: inherit; color: inherit; background: var(--ptw-chrome-btn, transparent);
  border: 1px solid ${CHROME_BORDER}; border-radius: ${CHROME_RADIUS}px;
  padding: 2px 8px;
}
/* QUIET buttons (the header's Undo / Reset / Source / Vim / Run real Lean, the
   offer line): text, no box until hover — the toolbar's hover wash. */
.ptw-pg .ptw-pg-quiet { background: transparent; border-color: transparent; }
.ptw-pg .ptw-pg-quiet:not(:disabled):hover { background: var(--ptw-toolbar-hover); }
.ptw-pg-head a { text-decoration: none; }
.ptw-pg-brand { font-weight: 600; color: inherit; }
.ptw-pg-head a[data-ptw-btn] {
  padding: 3px 10px; border-radius: ${CHROME_RADIUS}px; white-space: nowrap;
}
.ptw-pg-icon { display: inline-flex; align-items: center; justify-content: center; padding: 3px; }
.ptw-pg-linkish { color: var(--vscode-textLink-foreground, inherit); padding-left: 0; }
.ptw-pg-offer { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; font-size: ${CHROME_TEXT_SM}px; }
.ptw-pg button { cursor: pointer; }
.ptw-pg button:disabled { opacity: ${DISABLED_OPACITY}; cursor: default; }
.ptw-pg a { color: inherit; }
.ptw-pg-dim { opacity: ${DIM_OPACITY}; }
.ptw-pg-spacer { flex: 1 1 0; }
.ptw-pg-head select { min-width: 0; max-width: 260px; flex: 0 1 auto; }
.ptw-pg-intro {
  display: flex; align-items: baseline; gap: 12px;
  padding: 8px 12px; font-size: ${CHROME_TEXT}px; line-height: 1.45;
  border-bottom: 1px solid ${CHROME_BORDER}; color: ${CHROME_INK};
  border-left: 3px solid transparent;
}
.ptw-pg-intro > span:first-child { flex: 1 1 auto; min-width: 0; }
/* A PROVED theorem: the strip takes a thin green edge and a quiet wash of
   --ptw-closed (the closing marks' ink), "Proved" on its right. No motion. */
.ptw-pg-intro[data-proved] {
  border-left-color: var(--ptw-closed);
  background: color-mix(in srgb, var(--ptw-closed) 9%, transparent);
}
.ptw-pg-proved {
  flex: none; display: inline-flex; align-items: center; gap: 4px; align-self: center;
  color: var(--ptw-closed); font-weight: 600;
}
.ptw-pg-intro b { font-weight: 600; }
.ptw-pg code, .ptw-pg-mono { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.ptw-pg-main { flex: 1 1 auto; min-height: 0; display: flex; }
.ptw-pg-side {
  flex: 0 0 38%; min-width: 260px; max-width: 640px; min-height: 0;
  display: flex; flex-direction: column;
}
.ptw-pg-split {
  flex: 0 0 5px; cursor: col-resize; touch-action: none;
  border-left: 1px solid ${CHROME_BORDER};
}
.ptw-pg-split:hover, .ptw-pg-split:active { background: var(--ptw-focus, ${CHROME_BORDER}); }
.ptw-pg-src { flex: 1 1 auto; min-height: 120px; display: flex; flex-direction: column; }
.ptw-pg-src[hidden] { display: none; }
.ptw-pg-editor { flex: 1 1 auto; min-height: 0; }
.ptw-pg-goal {
  flex: 0 1 auto; max-height: 50%; overflow: auto; border-top: 1px solid ${CHROME_BORDER};
  padding: 8px 12px 10px; font-size: ${CHROME_TEXT}px; color: ${CHROME_INK};
  display: flex; flex-direction: column; gap: 6px;
}
.ptw-pg-src[hidden] + .ptw-pg-goal { flex: 1 1 auto; max-height: none; border-top: none; }
.ptw-pg-teach { line-height: 1.45; padding: 6px 8px; border-left: 3px solid var(--ptw-lightbulb, var(--ptw-accent)); background: var(--ptw-chrome-btn, transparent); }
.ptw-pg-after { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; border-top: 1px dashed ${CHROME_BORDER}; }
.ptw-pg-goal-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ptw-pg-goal-head select { min-width: 0; flex: 0 1 auto; max-width: 100%; }
.ptw-pg-goal-body { line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--vscode-editor-foreground); }
.ptw-pg-tree { flex: 1 1 auto; min-width: 0; min-height: 0; position: relative; }
.ptw-pg-try {
  border-top: 1px solid ${CHROME_BORDER}; padding: 8px 12px 10px;
  font-size: ${CHROME_TEXT}px; color: ${CHROME_INK};
  display: flex; flex-direction: column; gap: 6px;
}
.ptw-pg-row { display: flex; gap: 8px; align-items: center; min-width: 0; }
.ptw-pg-row select { flex: 0 1 38%; min-width: 0; }
.ptw-pg-row input { flex: 1 1 auto; min-width: 0; font-family: var(--vscode-editor-font-family); padding: 4px 8px; }
.ptw-pg-row button[type=submit] { flex: 0 0 auto; padding: 4px 12px; }
.ptw-pg-msg { line-height: 1.45; overflow-wrap: anywhere; }
.ptw-pg-caretmsg { display: flex; gap: 6px; align-items: flex-start; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; color: var(--vscode-editor-foreground); }
.ptw-pg-caretmsg-icon { flex: 0 0 auto; display: inline-flex; padding-top: 1px; }
.ptw-pg-msg[data-kind=error] { color: var(--ptw-danger, inherit); }
.ptw-pg-msg[data-kind=done] { color: var(--ptw-ok, inherit); }
.ptw-pg-done { font-weight: 600; }
.ptw-pg-hints { display: flex; flex-direction: column; gap: 6px; max-height: 180px; overflow: auto; }
.ptw-pg-hintlabel { font-size: ${CHROME_TEXT_SM}px; opacity: ${DIM_OPACITY}; margin-bottom: 3px; }
.ptw-pg-hintgroup[data-dim] .ptw-pg-chips { opacity: ${DIM_OPACITY}; }
.ptw-pg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ptw-pg-chips button {
  font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 2px 8px;
}
.ptw-pg-chips button:hover, .ptw-pg button:not(:disabled):not(.ptw-pg-quiet):not([data-ptw-btn]):hover { background: var(--ptw-chrome-lit); }
.ptw-pg-msgbox { padding: 24px; font-size: ${CHROME_TEXT}px; max-width: 640px; line-height: 1.5; }
.ptw-pg[data-narrow] .ptw-pg-head { gap: 8px; padding: 6px 10px; }
.ptw-pg[data-narrow] .ptw-pg-head select { flex: 1 1 160px; max-width: none; }
.ptw-pg[data-narrow] .ptw-pg-wide { display: none; }
.ptw-pg[data-narrow] .ptw-pg-intro { padding: 6px 10px; }
.ptw-pg-desktop-note { display: none; }
.ptw-pg[data-narrow] .ptw-pg-desktop-note { display: block; padding: 6px 10px; font-size: ${CHROME_TEXT_SM}px; opacity: ${DIM_OPACITY}; border-bottom: 1px solid var(--ptw-chrome-border); }
.ptw-pg[data-narrow] .ptw-pg-row { flex-wrap: wrap; }
.ptw-pg[data-narrow] .ptw-pg-row select { flex: 1 1 100%; }
/* iOS zooms into any field under 16px; a phone gets 16px fields */
.ptw-pg[data-narrow] input, .ptw-pg[data-narrow] select { font-size: 16px; }
.ptw-baked-lit { background: var(--ptw-chrome-lit); border-radius: 2px; }
`;

const codeOf = (fmt: TaggedText<BakedTag>) => <BakedCode fmt={fmt} />;

/** The little Markdown a blurb uses: `code`. */
function blurbNodes(s: string): ReactNode[] {
  return s.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

const goalLabel = (g: OpenGoal, i: number, n: number) =>
  `${n > 1 ? `${i + 1}/${n} · ` : ""}${g.caseName ? `${g.caseName}: ` : ""}⊢ ${g.target}`;

const VIM_KEY = "ramify.playground.vim";
const SIDE_KEY = "ramify.playground.sideWidth";
const SIDE_MIN = 260;
/** The tree keeps at least this much beside the source. */
const TREE_MIN = 320;
const SOURCE_KEY = "ramify.playground.source";
const docKey = (name: string) => `ramify.playground.doc.${name}`;
const REPLAY_MS = 180;
const CHECKING_MS = 300;

const EMPTY_RUN: TextRun = {
  comments: [],
  attempts: [],
  editorDiagnostics: [],
  anchors: new Map(),
  slots: [],
  edits: [],
  notBaked: new Map(),
  indent: new Map(),
};

/** One goal as the infoview prints it: case tag, hypotheses, `⊢ target`,
 tagged (hovers). */
function GoalText({ goal }: { goal: BakedGoal }) {
  return (
    <div className="ptw-pg-goal-body ptw-pg-mono">
      {goal.userName && <div className="ptw-pg-dim">case {goal.userName}</div>}
      {goal.hyps.map((h, i) => (
        <div key={i}>
          {daggerHtml(h.names.join(" "))} : <BakedCode fmt={h.type} />
        </div>
      ))}
      <div>
        {goal.goalPrefix ?? "⊢ "}
        <BakedCode fmt={goal.type} />
      </div>
    </div>
  );
}

/** THE GOAL PANEL — the playground's infoview, under the source. With the
 caret on a step: the goal that line works on (and Lean's message where it
 failed). Anywhere else: the open goal being worked on (a picker when there
 are several). In full, tagged (hovers), with the tactics computed in advance
 for it as chips that WRITE into the text, where Lean would read them next. */
function GoalPanel({
  built,
  run,
  table,
  caret,
  pick,
  onPick,
  live,
  offMap,
  showBaked,
  onShowBaked,
  write,
  edit,
  checking,
}: {
  built: Built & { proved: boolean };
  run: TextRun;
  table: Table;
  caret: { line: number; character: number } | null;
  pick: string | null;
  onPick: (id: string) => void;
  live: boolean;
  /** Open goals the bake never explored (frontier), live Lean off. */
  offMap: ReadonlySet<string>;
  showBaked: boolean;
  onShowBaked: (f: (v: boolean) => boolean) => void;
  write: (goalId: string, text: string) => boolean;
  /** Apply one edit to the text (the panel's "Name the cases"). */
  edit: (e: RewriteEdit) => void;
  /** A replay is taking a moment (live Lean). */
  checking: boolean;
}) {
  const atCaret = caret
    ? run.attempts.find((a) => a.at && caret.line >= a.at.start.line && caret.line <= a.at.stop.line)
    : undefined;
  const open = built.open;
  const target = open.find((g) => g.nodeId === pick) ?? open[0] ?? null;
  // the goal shown: the caret's step's, else the target open goal
  const goalId = atCaret ? atCaret.occ : (target?.nodeId ?? null);
  const entry = goalId ? built.proof.taggedGoals.find((e) => e.goalId === goalId) : undefined;
  const failed =
    atCaret?.play.kind === "error"
      ? atCaret
      : !atCaret && target?.failed
        ? run.attempts.find((a) => a.occ === target.occ && a.play.kind === "error")
        : undefined;
  // THE CARET LINE'S MESSAGE (the infoview's "Messages"): the first
  // diagnostic whose range covers the caret's line, worst first
  const caretDiag = caret
    ? run.editorDiagnostics
        .filter((d) => caret.line >= d.range.start.line && caret.line <= d.range.stop.line)
        .sort((a, b) => (a.severity ?? 1) - (b.severity ?? 1))[0]
    : undefined;
  // the first error anywhere in the text: a closed proof with one is not proved
  const firstError = run.editorDiagnostics.find((d) => (d.severity ?? 1) === 1);
  const caretSev = (caretDiag ? Math.min(3, Math.max(1, caretDiag.severity ?? 1)) : 1) as Severity;
  const waiting = !atCaret && target ? run.notBaked.get(target.nodeId) : undefined;
  // hints for the open goal shown (a step's goal is not open: no chips)
  const openShown = !atCaret ? target : (open.find((g) => g.nodeId === `${atCaret.occ}~`) ?? null);
  const anchored = openShown ? run.anchors.has(openShown.nodeId) : false;
  const baked = openShown ? completions(table, openShown.state, openShown.aliases) : [];
  // a goal the demo never reached has no baked hints: live Lean runs the
  // baker's own candidates on it instead (fetched on the click, per goal)
  const [liveList, setLiveList] = useState<{ state: number; list: string[] } | null>(null);
  const liveHere = openShown && liveList?.state === openShown.state ? liveList.list : null;
  const askLive = () => {
    if (!openShown) return;
    const { state, aliases } = openShown;
    const show = new Map(aliases.map(([c, v]) => [c, v] as [string, string]));
    void liveHints(table, LIVE, state).then((list) =>
      setLiveList({ state, list: list.map((c) => renameWords(c, show)) }),
    );
  };
  // the hints, RANKED (rankedCompletions): what closes the goal, what makes
  // progress, then the rest dimmed. Live Lean's list carries no outcomes: one
  // unlabelled run.
  const fromTable = waiting ? waiting.completions.length > 0 : baked.length > 0;
  const shownHints = waiting || showBaked;
  const ranked = shownHints && fromTable && openShown ? rankedCompletions(table, openShown.state, openShown.aliases) : null;
  const groups: { label: string; list: string[]; dim?: boolean }[] = ranked
    ? [
        { label: "Closes this goal", list: ranked.closes },
        { label: "Makes progress", list: ranked.progress },
        { label: "Other moves", list: ranked.other, dim: true },
      ].filter((g) => g.list.length > 0)
    : shownHints && liveHere && liveHere.length > 0
      ? [{ label: "", list: liveHere }]
      : [];
  // a tactic that did not run because the lines below it are indented under
  // it (playgroundText.ts `swallowed`)
  const indentNote = atCaret
    ? run.indent.get(atCaret.occ)
    : target
      ? run.indent.get(target.nodeId.replace(/~$/, ""))
      : undefined;
  const offMapTarget = !atCaret && !!target && offMap.has(target.nodeId);
  const nOpen = open.length;
  // TEACHING: the goal shown has hypotheses Lean left unnamed (`h✝`) by a
  // split written without alternatives — say so, and offer the named form
  // (nameCases.ts, the tree's own Quick Fix text)
  const namesOf = (id: string) =>
    built.proof.taggedGoals.find((e) => e.goalId === id)?.goal.hyps.flatMap((h) => h.names) ?? [];
  const baseId = goalId?.replace(/~$/, "") ?? null;
  const split =
    baseId && entry && namesOf(baseId).some(isInaccessible)
      ? run.attempts.find((a) => a.kids?.includes(baseId) && a.at && isUnnamedSplit(a.play.label))
      : undefined;
  // only while no case has a step yet (the skeleton's `sorry`s would leave
  // steps written under the split with no goals) — nameCasesRewrite's rule
  const casesUntouched = !!split?.kids?.every((k) => !run.attempts.some((a) => a.occ === k));
  const nameFix = (() => {
    if (!split?.at || !split.kids || !casesUntouched) return null;
    const parent = new Set(namesOf(split.occ));
    const arms = split.kids.map((k) => {
      const names = namesOf(k);
      const tag = built.proof.taggedGoals.find((e) => e.goalId === k)?.goal.userName ?? "";
      return { tag, names, introduced: names.filter((n) => !parent.has(n)) };
    });
    const text = nameCasesText(split.play.label, split.at.start.character, arms);
    return text ? { range: { start: split.at.start, end: split.at.stop }, newText: text } : null;
  })();
  return (
    <div className="ptw-pg-goal" role="region" aria-label="Goal">
      <div className="ptw-pg-goal-head">
        {atCaret ? (
          <span>
            Goal for <code>{atCaret.play.label}</code>
          </span>
        ) : nOpen > 1 && target ? (
          <select aria-label="The goal to work on" value={target.nodeId} onChange={(e) => onPick(e.target.value)}>
            {open.map((g, i) => (
              <option key={g.nodeId} value={g.nodeId}>
                {goalLabel(g, i, nOpen)}
              </option>
            ))}
          </select>
        ) : (
          <span>{built.closed ? "No goals" : nOpen === 1 ? "1 goal open" : `${nOpen} goals open`}</span>
        )}
        <span className="ptw-pg-spacer" />
        {checking && (
          <span className="ptw-pg-dim" role="status">
            Lean is checking…
          </span>
        )}
        {anchored && !waiting && (baked.length > 0 || live) && (
          <button
            type="button"
            onClick={() => {
              if (baked.length === 0 && !showBaked) askLive();
              onShowBaked((v) => !v);
            }}
            aria-expanded={showBaked}
            title={baked.length > 0 ? "Tactics Lean answered here in advance" : "Ask live Lean which tactics succeed here"}
          >
            {showBaked ? "Hide hints" : "Hints"}
          </button>
        )}
      </div>
      {caretDiag && (
        <div className="ptw-pg-caretmsg" data-sev={caretSev} title={caretDiag.message}>
          <span
            className="ptw-pg-caretmsg-icon"
            style={{ color: DIAG_ICON[caretSev].ink, opacity: DIAG_ICON[caretSev].opacity }}
            aria-label={caretSev === 1 ? "Error" : caretSev === 2 ? "Warning" : "Info"}
          >
            <Codicon name={DIAG_ICON[caretSev].name} />
          </span>
          <span className="ptw-pg-mono">{caretDiag.message.split("\n")[0]}</span>
        </div>
      )}
      {entry && <GoalText goal={entry.goal} />}
      {atCaret?.play.kind === "ok" && (
        <div className="ptw-pg-after">
          <div className="ptw-pg-dim">
            {(atCaret.kids ?? []).length === 0
              ? "After this step: no goals — it closes this one."
              : (atCaret.kids ?? []).length === 1
                ? "After this step:"
                : `After this step: ${(atCaret.kids ?? []).length} goals`}
          </div>
          {(atCaret.kids ?? []).map((k) => {
            const e = built.proof.taggedGoals.find((x) => x.goalId === k);
            return e ? <GoalText key={k} goal={e.goal} /> : null;
          })}
        </div>
      )}
      {nameFix && (
        <div className="ptw-pg-teach">
          <span>
            Names with <code>✝</code> are ones Lean made up: you cannot type them. Name them where the
            cases split:
          </span>{" "}
          <button type="button" onClick={() => edit(nameFix)} title="Rewrite the split with one named alternative per case">
            Name the cases
          </button>
        </div>
      )}
      <div className="ptw-pg-msg" role="status" data-kind={failed ? "error" : built.proved && !atCaret ? "done" : undefined}>
        {indentNote ? (
          <span>{indentNote}</span>
        ) : failed && failed.play.kind === "error" && caretDiag?.message !== failed.play.error ? (
          <span title={failed.play.error}>
            Lean: {failed.play.error.split("\n")[0]}{" "}
            <span className="ptw-pg-dim">(the whole message is on the squiggle). Edit the line, or delete it.</span>
          </span>
        ) : waiting ? (
          <span>
            <code>{waiting.label}</code> is not in this demo
            {!live && LIVE_OFFERED ? <span className="ptw-pg-dim"> (Run real Lean, top right, to check any tactic)</span> : null}
            {waiting.frontier
              ? " — the demo was not explored past this goal."
              : waiting.completions.length > 0
                ? ". Lean's answers here were computed in advance for:"
                : "."}
          </span>
        ) : built.closed && !built.proved && !atCaret && firstError ? (
          <span>
            Every goal is closed, but Lean reports an error on line {firstError.range.start.line + 1}:{" "}
            <code>{firstError.message.split("\n")[0]}</code>
          </span>
        ) : built.proved && !atCaret ? (
          <span>
            <span className="ptw-pg-done">Proof complete — every goal closed.</span>{" "}
            <span className="ptw-pg-dim">
              Every goal and error is what Lean said. <a href={RELEASE_URL}>Get Ramify for VS Code</a> to write your own.
            </span>
          </span>
        ) : offMapTarget ? (
          <span>{OFF_MAP_NOTE}</span>
        ) : !atCaret && !anchored && target ? (
          <span className="ptw-pg-dim">This goal waits on a line above it that did not succeed.</span>
        ) : !atCaret ? (
          <span className="ptw-pg-dim">
            Write the next tactic in the source, or use <code>+</code> under a goal in the tree.
          </span>
        ) : null}
      </div>
      {groups.length > 0 && openShown && anchored && (
        <div className="ptw-pg-hints" aria-label="Tactics with an answer here">
          {groups.map((g) => (
            <div key={g.label} className="ptw-pg-hintgroup" data-dim={g.dim ? "" : undefined}>
              {g.label && <div className="ptw-pg-hintlabel">{g.label}</div>}
              <div className="ptw-pg-chips">
                {g.list.map((c) => (
                  <button key={c} type="button" onClick={() => write(openShown.nodeId, c)} title={`Write ${c}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <LiveOffer />
    </div>
  );
}

function PlaygroundBody({
  entry,
  table,
  head,
  kind,
}: {
  entry: Entry;
  table: Table;
  head: (extra: ReactNode) => ReactNode;
  kind: ThemeKind;
}) {
  // baked first; the live engine answers only once it is running, and only
  // what the table lacks (its answers are recorded into the table)
  const answer = useMemo(() => makeAnswer([bakedEngine(table), liveEngine(table, LIVE)]), [table]);
  const live = useLiveStatus();
  const header = `theorem ${table.bake.theorem} : ${table.bake.statement} := by`;

  // THE TEXT is the source of truth: the editor holds it, every gesture below
  // is an edit to it, and each edit replays it (playgroundText.ts)
  const [initialDoc] = useState(() => {
    const saved = stored(docKey(entry.name));
    return saved && saved.split("\n")[0] === header ? saved : freshDoc(header);
  });
  const editor = useRef<EditorHandle>(null);
  const docRef = useRef(initialDoc);
  const gen = useRef(0);
  const timer = useRef<number | null>(null);
  const cache = useRef<PlayCache>(new Map());
  const [run, setRun] = useState<TextRun>(EMPTY_RUN);
  const [caret, setCaret] = useState<{ line: number; character: number } | null>(null);
  const [vimOn, setVimOn] = useState(() => stored(VIM_KEY) === "on");
  const [sourceOn, setSourceOn] = useState(() => stored(SOURCE_KEY) !== "off");
  // the divider: the source pane's width in px (null = the CSS default, 38%)
  const [sideW, setSideW] = useState<number | null>(() => {
    const v = Number(stored(SIDE_KEY));
    return Number.isFinite(v) && v >= SIDE_MIN ? v : null;
  });
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const side = e.currentTarget.previousElementSibling as HTMLElement | null;
    if (!side) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = side.getBoundingClientRect().width;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const clamp = (w: number) => Math.max(SIDE_MIN, Math.min(window.innerWidth - TREE_MIN, w));
    const move = (ev: PointerEvent) => setSideW(clamp(w0 + ev.clientX - x0));
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      store(SIDE_KEY, String(Math.round(clamp(w0 + ev.clientX - x0))));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  const [pick, setPick] = useState<string | null>(null);
  const [showBaked, setShowBaked] = useState(false);

  // a replay that takes a moment (live Lean on an unbaked line) says so after
  // CHECKING_MS; a quick one (the table) never flashes it
  const [checking, setChecking] = useState(false);
  const replay = useCallback(
    (doc: string) => {
      const g = ++gen.current;
      const slow = window.setTimeout(() => {
        if (g === gen.current) setChecking(true);
      }, CHECKING_MS);
      void replayText(table, answer, doc, cache.current, LIVE_OFFERED).then((r) => {
        window.clearTimeout(slow);
        if (g === gen.current) {
          setRun(r);
          setChecking(false);
        }
      });
    },
    [table, answer],
  );
  // the first replay, and again once live Lean is up (lines the table lacks
  // were left waiting; they are not cached)
  useEffect(() => {
    replay(docRef.current);
  }, [replay, live.kind]);

  const onText = useCallback(
    (doc: string) => {
      docRef.current = doc;
      store(docKey(entry.name), doc);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => replay(doc), REPLAY_MS);
    },
    [entry.name, replay],
  );

  const built = useMemo(() => {
    const b = buildProof(table, run.attempts, `playground:${entry.name}`);
    // the text's own comments: strips on their steps, and their flags
    // PROVED = every goal closed AND Lean has no error anywhere in the text
    // (a stray step after the last goal is "No goals to be proved." — the
    // file does not compile, so nothing may say it is proved)
    const proved = b.closed && !run.editorDiagnostics.some((d) => (d.severity ?? 1) === 1);
    return { ...b, proved, proof: { ...b.proof, comments: run.comments } };
  }, [table, run, entry.name]);

  const renderers = useMemo(
    () => makeTaggedRenderersWith(built.proof, built.proof.taggedGoals, codeOf),
    [built],
  );
  const diagnostics = useMemo(
    () => filterDiagnostics(built.diagnostics, proofSpan(built.proof)).kept,
    [built],
  );

  // The open goal being worked on — GoalPanel's `target`: the picked one,
  // else the first. The tree boxes it (`targetGoalId`).
  const targetGoalId =
    (built.open.find((g) => g.nodeId === pick) ?? built.open[0])?.nodeId ?? null;
  // OFF-MAP: open goals the bake never explored (frontier) while live Lean is
  // not there to answer past them — drawn dashed and dimmed in the tree
  const liveReady = live.kind === "ready";
  const offMap = useMemo(
    () => new Set(liveReady ? [] : built.open.filter((g) => g.frontier).map((g) => g.nodeId)),
    [built, liveReady],
  );

  // the reader's view, kept in the hash beside `t=` (read back on a reload)
  const [initialView] = useState(() => ({
    layout: viewWords.now.layout ?? START_VIEW.layout,
    context: viewWords.now.context ?? START_VIEW.context,
    comments: viewWords.now.comments,
  }));
  const onViewState = useCallback(
    (v: Required<ViewWords>) => {
      viewWords.now = v;
      const h = hashFor(entry.name);
      if (location.hash !== h) history.replaceState(null, "", h);
    },
    [entry.name],
  );

  /** Write `text` as the next tactic of an open goal (by node id). */
  const writeFor = useCallback(
    (goalId: string, text: string): boolean => {
      const a = run.anchors.get(goalId);
      if (!a || text.trim() === "") return false;
      editor.current?.apply(a(text.trim()));
      return true;
    },
    [run],
  );

  // the tree's gestures, as text edits
  const onTryTactic = useCallback(
    (goalId: string, text: string) => {
      writeFor(goalId, text);
    },
    [writeFor],
  );
  const getGoalTactics = useCallback(
    (goalId: string) => {
      const g = built.open.find((o) => o.nodeId === goalId);
      return g ? completions(table, g.state, g.aliases) : [];
    },
    [built, table],
  );
  const same = (a: { line: number; character: number }, b: { line: number; character: number }) =>
    a.line === b.line && a.character === b.character;
  const getTacticEdit = useCallback(
    (pos: ProofStepPosition) => {
      const e = run.edits.find((x) => same(x.pos.start, pos.start));
      return e ? { pos: e.pos, text: e.text, indent: e.pos.start.character } : null;
    },
    [run],
  );
  const onEditTactic = useCallback((pos: ProofStepPosition, newText: string) => {
    editor.current?.apply({ range: { start: pos.start, end: pos.stop }, newText });
  }, []);
  const onDeleteTactic = useCallback(
    (spec: DeleteSpec) => {
      const e = deleteEdit(spec, run.slots);
      if (e) editor.current?.apply(e, false);
    },
    [run],
  );
  const onReveal = useCallback((pos: ProofStepPosition) => editor.current?.reveal(pos), []);
  // the tree's restructurings (Quick Fix / Refactor rows, through the proposal
  // pill): every edit into the text, the last first so the earlier ranges hold
  const onApplyRewrite = useCallback((edits: RewriteEdit[]) => {
    const later = (a: RewriteEdit, b: RewriteEdit) =>
      b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character;
    for (const e of [...edits].sort(later)) editor.current?.apply(e, false);
  }, []);
  const onUndo = useCallback((redo: boolean) => (redo ? editor.current?.redo() : editor.current?.undo()), []);

  const reset = () => editor.current?.setText(freshDoc(header));
  const toggleVim = () => {
    setVimOn((v) => {
      store(VIM_KEY, v ? "off" : "on");
      return !v;
    });
    editor.current?.focus();
  };
  const toggleSource = () =>
    setSourceOn((v) => {
      store(SOURCE_KEY, v ? "off" : "on");
      return !v;
    });

  return (
    <>
      {head(
        <>
          <button type="button" className="ptw-pg-quiet" onClick={() => editor.current?.undo()} title="Undo the last edit (⌘Z in the editor)">
            Undo
          </button>
          <button type="button" className="ptw-pg-quiet" onClick={reset} title="Start this theorem again">
            Reset
          </button>
          <button
            type="button"
            className="ptw-pg-quiet"
            onClick={toggleSource}
            aria-pressed={sourceOn}
            title={sourceOn ? "Hide the source (the tree and the bar still write it)" : "Show the source beside the tree"}
          >
            Source
          </button>
          <button
            type="button"
            className="ptw-pg-quiet"
            onClick={toggleVim}
            aria-pressed={vimOn}
            disabled={!sourceOn}
            title={vimOn ? "Vim keys are on in the source — click to turn them off" : "Use vim keys in the source"}
          >
            Vim: {vimOn ? "on" : "off"}
          </button>
        </>,
      )}
      <div className="ptw-pg-desktop-note" role="note">
        Best on a desktop: the playground is built for a keyboard and a wide screen.
      </div>
      <div className="ptw-pg-intro" data-proved={built.proved ? "" : undefined}>
        <span>
          <b>{entry.title}.</b> {blurbNodes(entry.blurb)}
        </span>
        {built.proved && (
          <span className="ptw-pg-proved" role="status">
            <Codicon name={ICON["page.proved"]} />
            Proved
          </span>
        )}
      </div>
      <div className="ptw-pg-main">
        <div className="ptw-pg-side" style={sideW ? { flexBasis: sideW, maxWidth: "none" } : undefined}>
          <div className="ptw-pg-src" hidden={!sourceOn}>
            <PlaygroundEditor
              ref={editor}
              initial={initialDoc}
              vimOn={vimOn}
              diagnostics={run.editorDiagnostics}
              onText={onText}
              onCaret={setCaret}
            />
          </div>
          <GoalPanel
            built={built}
            run={run}
            table={table}
            caret={caret}
            pick={pick}
            onPick={setPick}
            live={live.kind === "ready"}
            offMap={offMap}
            showBaked={showBaked}
            onShowBaked={setShowBaked}
            write={writeFor}
            edit={(e) => editor.current?.apply(e, false)}
            checking={checking}
          />
        </div>
        <div
          className="ptw-pg-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the source (double-click resets)"
          title="Drag to resize the source (double-click resets)"
          onPointerDown={startDrag}
          onDoubleClick={() => {
            setSideW(null);
            store(SIDE_KEY, "");
          }}
        />
        <div className="ptw-pg-tree">
          {/* the bake's popups plus the renamed copies the visitor's names mint */}
          <BakedPopups.Provider value={built.hovers}>
            <WidgetBoundary resetKey={entry.name}>
              <ProofTreeView
                proof={built.proof}
                tokenColors={TOKEN_PALETTE[kind]}
                // the editor's first line IS the signature: no second copy
                // over the tree (the root goal is the third)
                signatureHeader={false}
                declHeader={built.proof.declHeader}
                declHeaderStart={built.proof.declHeaderStart}
                highlightPos={caret}
                // the open goal the goal panel addresses (its picker, else
                // the first), boxed in the focus ink; every closing step
                // wears `∎`; a complete proof leaves no step accented
                targetGoalId={targetGoalId}
                closedMarks
                cursorAccent={!built.proved}
                height="100%"
                renderTaggedGoal={renderers.renderTaggedGoal}
                renderTaggedHyps={renderers.renderTaggedHyps}
                diagnostics={diagnostics}
                experience={EXPERIENCE}
                appearance={APPEARANCE}
                initialView={initialView}
                onViewState={onViewState}
                initialZoom={START_ZOOM}
                offMapGoalIds={offMap}
                offMapNote={OFF_MAP_NOTE}
                onTryTactic={onTryTactic}
                getGoalTactics={getGoalTactics}
                getTacticEdit={getTacticEdit}
                onEditTactic={onEditTactic}
                deleteSlots={run.slots}
                onDeleteTactic={onDeleteTactic}
                onReveal={onReveal}
                onApplyRewrite={onApplyRewrite}
                onUndo={onUndo}
              />
            </WidgetBoundary>
          </BakedPopups.Provider>
        </div>
      </div>
    </>
  );
}

export default function Playground() {
  injectStyleOnce("ptw-pg-page", PAGE_CSS);
  const [kind, toggleTheme] = useTheme();
  const narrow = useNarrow(NARROW_PX);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [name, setName] = useState<string | null>(
    () => new URLSearchParams(location.hash.slice(1)).get("t"),
  );
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; name: string; table: Table }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;
    fetch("playground/index.json")
      .then((r) => {
        if (!r.ok) throw new Error(`No playground list (${r.status}).`);
        return r.json();
      })
      .then((j: { theorems: Entry[] }) => live && setEntries(j.theorems))
      .catch(
        (e: unknown) =>
          live &&
          setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, []);

  const entry = entries?.find((e) => e.name === name) ?? entries?.[0] ?? null;
  const want = entry?.name ?? null;
  useEffect(() => {
    if (!want) return;
    let live = true;
    fetch(`playground/${encodeURIComponent(want)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`No playground theorem named “${want}” (${r.status}).`);
        return r.json();
      })
      .then((j) => live && setState({ kind: "ready", name: want, table: loadTable(checkBake(j)) }))
      .catch(
        (e: unknown) =>
          live &&
          setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      live = false;
    };
  }, [want]);

  // The hash names the theorem (an external system: no state is set here).
  useEffect(() => {
    if (!want) return;
    const h = hashFor(want);
    if (location.hash !== h) history.replaceState(null, "", h);
    document.title = `${entry?.title ?? want} — Ramify playground`;
  }, [want, entry]);
  useEffect(() => {
    const on = () => {
      viewWords.now = viewWordsOf(location.hash);
      setName(new URLSearchParams(location.hash.slice(1)).get("t"));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const head = (extra: ReactNode) => (
    <header className="ptw-pg-head" {...chromeScopeProps()}>
      <a href="./" className="ptw-pg-brand" title="Every published proof">
        Ramify
      </a>
      <span className="ptw-pg-dim">Playground</span>
      {entries && (
        <select
          aria-label="Theorem"
          value={want ?? ""}
          onChange={(e) => setName(e.target.value)}
        >
          {entries.map((e) => (
            <option key={e.name} value={e.name}>
              {e.title}
            </option>
          ))}
        </select>
      )}
      {extra}
      <span className="ptw-pg-spacer" />
      <LiveButton />
      <a
        className="ptw-pg-wide"
        data-ptw-btn=""
        href={RELEASE_URL}
        title="Here Lean's answers were computed in advance, or come from Lean running in this tab. In VS Code the same tree follows your own files as you type."
      >
        Get Ramify for VS Code
      </a>
      <button
        type="button"
        className="ptw-pg-quiet ptw-pg-icon"
        title={kind === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label={kind === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={toggleTheme}
      >
        <Codicon name={ICON["page.theme"]} />
      </button>
    </header>
  );

  const ready = state.kind === "ready" && entry && state.name === entry.name ? state : null;
  return (
    <div
      className="ptw-pg"
      data-narrow={narrow ? "" : undefined}
      {...chromeScopeProps()}
      data-ptw-theme={kind}
      style={Object.fromEntries(
        Object.entries(TOKEN_PALETTE[kind]).map(([k, v]) => [`--ptw-tok-${k}`, v]),
      )}
    >
      {ready && entry ? (
        <PlaygroundBody key={entry.name} entry={entry} table={ready.table} head={head} kind={kind} />
      ) : (
        <>
          {head(null)}
          <div className="ptw-pg-msgbox">
            {state.kind === "error" ? (
              <>
                <p>The playground could not load.</p>
                <p className="ptw-pg-dim">{state.message}</p>
              </>
            ) : (
              <p className="ptw-pg-dim">Loading…</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
