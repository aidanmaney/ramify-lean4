// THE STATIC VIEWER — Ramify with no Lean server.
//
// Lean ran once, on the author's machine (`ppharness --widget-data`, gathered
// by `web/scripts/publish.mjs` into a versioned payload per source file); this
// page is plain HTML, JS and JSON. It renders the SAME view as the infoview
// widget and the harness, fed from the payload:
//
//   payload ──▶ ProofTreeView (no edit hooks, no companion)  ◀──▶  source pane
//
// No edit hook is passed, so every move that needs Lean (edit, chips, delete,
// completion, ⇓ ⇑ ⤵ ⤴ ✎, rename, counterfactual, polish, propose, lens, undo)
// is absent through the gates the view already has (`caps`, `availability`
// answering `never-session`). Nothing here asks the view to behave differently
// from any other caller; if a Lean-only move shows, the gate is what is wrong.
//
// What stands in for the editor is the SOURCE PANE: a click there moves the
// cursor the view follows, and `»` scrolls it to the step and washes the
// step's tight range.
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import ProofTreeView from "./ProofTreeView";
import { BakedCode } from "./bakedCode";
import { BakedPopups } from "./bakedPopups";
import { filterDiagnostics, proofSpan } from "./diagnostics";
import { WidgetBoundary } from "./errorBoundary";
import { PRESETS, parseExperience } from "./experience";
import type { ProofStepPosition } from "./paperproof";
import SourcePane, { type SourceRange } from "./sourcePane";
import { makeTacticRendererWith, renderTacticTokensWith } from "./tacticCore";
import type { Elision } from "./tacticCore";
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
  chromeScopeProps,
  type ThemeKind,
} from "./theme";
import { formatLink, parseLink, type ViewerLink } from "./viewerLink";
import {
  checkPayload,
  proofSlug,
  type BakedTag,
  type ViewerPayload,
  type ViewerProof,
} from "./viewerPayload";
import {
  TOKEN_PALETTE,
  applyTheme,
  storeTheme,
  storedTheme,
  systemTheme,
} from "./viewerTheme";

type LspPos = { line: number; character: number };

/** Where the editor lives: the onboarding line's two links. */
const RELEASE_URL = "https://github.com/aidanmaney/ramify-lean4/releases/latest";
const INSTALL_URL =
  "https://github.com/aidanmaney/ramify-lean4/blob/main/INSTALL.md";

/** The split's limits: the source keeps room for a line of code, the tree
 room for its status strip. */
const SPLIT_MIN_PX = 240;
const TREE_MIN_PX = 360;
const SPLIT_KEY = "ramify-viewer-split";

/** The reader's split, as the SOURCE's fraction of the row (a fraction, so it
 survives a different window), or null for the default. */
function storedSplit(): number | null {
  try {
    const v = Number(window.localStorage.getItem(SPLIT_KEY));
    return v > 0 && v < 1 ? v : null;
  } catch {
    return null;
  }
}
function storeSplit(f: number | null) {
  try {
    if (f === null) window.localStorage.removeItem(SPLIT_KEY);
    else window.localStorage.setItem(SPLIT_KEY, String(f));
  } catch {
    // No storage: the split lasts for this page only.
  }
}

/** The handle between the source and the tree. While dragging it writes the
 width straight onto the row (`--ptw-src-w`), so the tree view is not
 re-rendered per pointer move; the fraction is committed on release. */
function SplitHandle({
  split,
  setSplit,
}: {
  split: number | null;
  setSplit: (f: number | null) => void;
}) {
  const clampPx = (row: DOMRect, px: number) =>
    Math.max(SPLIT_MIN_PX, Math.min(row.width - TREE_MIN_PX, px));
  const nudge = (el: HTMLElement, by: number) => {
    const row = el.parentElement!.getBoundingClientRect();
    const src = el.parentElement!.querySelector(".ptw-viewer-src");
    const cur = src ? src.getBoundingClientRect().width : row.width * 0.4;
    setSplit(clampPx(row, cur + by) / row.width);
  };
  return (
    <div
      className="ptw-viewer-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the source and the tree — drag, ← / →, double-click to reset"
      title="Drag to resize · double-click to reset"
      aria-valuenow={split === null ? 40 : Math.round(split * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onDoubleClick={() => setSplit(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          nudge(e.currentTarget, e.key === "ArrowLeft" ? -32 : 32);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const handle = e.currentTarget;
        const rowEl = handle.parentElement!;
        const page = rowEl.closest<HTMLElement>(".ptw-viewer");
        const row = rowEl.getBoundingClientRect();
        handle.setPointerCapture(e.pointerId);
        handle.dataset.drag = "";
        if (page) page.dataset.dragging = "";
        let px: number | null = null;
        const move = (ev: PointerEvent) => {
          px = clampPx(row, ev.clientX - row.left);
          rowEl.style.setProperty("--ptw-src-w", `${px}px`);
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          delete handle.dataset.drag;
          if (page) delete page.dataset.dragging;
          if (px !== null) setSplit(px / row.width);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      }}
    />
  );
}

/** Under this width the source pane stacks under the tree. */
const NARROW_PX = 860;

const QUERY = new URLSearchParams(location.search);
const EXPERIENCE = parseExperience(QUERY.get("experience"));

const PAGE_CSS = `
html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: ${CHROME_FONT};
}
.ptw-viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ptw-viewer-head {
  display: flex; align-items: center; gap: 10px; white-space: nowrap;
  padding: 6px 12px; min-width: 0; border-bottom: 1px solid ${CHROME_BORDER};
  font-size: ${CHROME_TEXT}px; color: ${CHROME_INK};
}
.ptw-viewer-head select, .ptw-viewer-head button {
  font: inherit; color: inherit; background: var(--ptw-chrome-btn, transparent);
  border: 1px solid ${CHROME_BORDER}; border-radius: ${CHROME_RADIUS}px;
  padding: 2px 6px; cursor: pointer;
}
.ptw-viewer-head button[aria-pressed="true"] { background: var(--ptw-chrome-lit); }
.ptw-viewer-head a { color: inherit; }
.ptw-viewer-file { font-family: var(--vscode-editor-font-family); }
.ptw-viewer-dim { opacity: ${DIM_OPACITY}; }
.ptw-viewer-spacer { flex: 1 1 0; }
.ptw-viewer-note { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ptw-viewer-head select { min-width: 0; max-width: 240px; flex: 0 1 auto; }
.ptw-viewer-main { flex: 1 1 auto; display: flex; min-height: 0; }
.ptw-viewer-tree { flex: 1 1 60%; min-width: 0; min-height: 0; position: relative; }
/* The source on the LEFT and the tree on the right, where the infoview sits
   beside the editor in VS Code. Narrow, the tree stacks first (order reset). */
.ptw-viewer-src {
  order: -1;
  flex: 0 0 var(--ptw-src-w, 40%); min-width: ${SPLIT_MIN_PX}px; min-height: 0;
  display: flex; flex-direction: column;
}
/* The split's handle: a hairline in a wider hit strip, between the source
   (order -1, first) and the tree. Drag to resize, double-click to reset,
   ← / → when focused. */
.ptw-viewer-split {
  order: -1; flex: 0 0 7px; margin: 0 -3px; z-index: 1;
  cursor: col-resize; touch-action: none; outline: none;
  background: linear-gradient(${CHROME_BORDER}, ${CHROME_BORDER}) center / 1px 100% no-repeat;
}
.ptw-viewer-split:hover, .ptw-viewer-split[data-drag], .ptw-viewer-split:focus-visible {
  background: linear-gradient(var(--ptw-focus), var(--ptw-focus)) center / 3px 100% no-repeat;
}
.ptw-viewer[data-dragging], .ptw-viewer[data-dragging] * { cursor: col-resize !important; user-select: none; }
.ptw-viewer[data-narrow] .ptw-viewer-split { display: none; }
.ptw-viewer[data-narrow] .ptw-viewer-main { flex-direction: column; }
.ptw-viewer[data-narrow] .ptw-viewer-tree { flex: 1 1 58%; }
.ptw-viewer[data-narrow] .ptw-viewer-src {
  order: 0;
  flex: 1 1 42%; min-width: 0;
  border-top: 1px solid ${CHROME_BORDER};
}
.ptw-viewer[data-narrow] .ptw-viewer-head { flex-wrap: wrap; row-gap: 6px; }
.ptw-viewer[data-narrow] .ptw-viewer-head select { flex: 1 1 140px; max-width: none; }
.ptw-viewer[data-narrow] .ptw-viewer-note,
.ptw-viewer[data-narrow] .ptw-viewer-file,
.ptw-viewer[data-narrow] .ptw-viewer-install { display: none; }
.ptw-viewer[data-narrow] .ptw-viewer-head { gap: 8px; padding: 6px 10px; }
.ptw-src {
  flex: 1 1 auto; overflow: auto; padding: 6px 0;
  font-family: var(--vscode-editor-font-family); font-size: 12.5px; line-height: 19px;
  white-space: pre; cursor: text;
}
.ptw-src-line { display: flex; padding-right: 12px; }
.ptw-src-gutter {
  flex: 0 0 auto; width: 3.2em; padding-right: 1em; text-align: right;
  opacity: 0.45; user-select: none; border-right: 2px solid transparent;
}
.ptw-src-decl .ptw-src-gutter { opacity: ${DIM_OPACITY}; border-right-color: var(--ptw-node-goal-stroke, ${CHROME_BORDER}); }
.ptw-src-text { padding-left: 10px; }
.ptw-src-cursor { background: var(--ptw-chrome-lit); }
.ptw-src-hl { background: var(--vscode-diffEditor-insertedTextBackground); border-radius: 2px; }
.ptw-baked-lit { background: var(--ptw-chrome-lit); border-radius: 2px; }
.ptw-viewer-msg { padding: 24px; font-size: ${CHROME_TEXT}px; max-width: 640px; line-height: 1.5; }
`;

/** The payload this page shows: inline (a single-file export) or fetched
 (`data/<file>.json` beside the page). */
function inlinePayload(): unknown | null {
  const el = document.getElementById("ramify-payload");
  return el?.textContent ? JSON.parse(el.textContent) : null;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_PX);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < NARROW_PX);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

function useTheme(): [ThemeKind, () => void] {
  const [picked, setPicked] = useState<ThemeKind | null>(storedTheme);
  const [system, setSystem] = useState<ThemeKind>(systemTheme);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const on = () => setSystem(mq!.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq!.removeEventListener("change", on);
  }, []);
  const kind = picked ?? system;
  // Before paint would be nicer, but the view re-resolves on the attribute
  // change (`observeThemeChange`), so an effect is enough.
  useEffect(() => applyTheme(kind), [kind]);
  const toggle = () => {
    const next: ThemeKind = kind === "dark" ? "light" : "dark";
    // Back to following the system when the pick would equal it.
    const stored = next === system ? null : next;
    storeTheme(stored);
    setPicked(stored);
  };
  return [kind, toggle];
}

/** The declaration whose range holds `p`, if any. */
function proofAt(payload: ViewerPayload, p: LspPos): ViewerProof | undefined {
  const le = (a: LspPos, b: LspPos) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character);
  return payload.proofs.find(
    (r) =>
      r.proof.declRange &&
      le(r.proof.declRange.start, p) &&
      le(p, r.proof.declRange.stop),
  );
}

const codeOf = (fmt: TaggedText<BakedTag>) => <BakedCode fmt={fmt} />;

function ViewerBody({
  payload,
  link,
  kind,
  head,
  paneOpen,
  setPaneOpen,
  onLink,
  onViewState,
}: {
  payload: ViewerPayload;
  link: ViewerLink;
  kind: ThemeKind;
  head: (picker: ReactNode) => ReactNode;
  paneOpen: boolean;
  setPaneOpen: (v: boolean) => void;
  onLink: (l: ViewerLink) => void;
  onViewState: (s: Pick<ViewerLink, "layout" | "context" | "comments">) => void;
}) {
  const record =
    payload.proofs.find((r) => proofSlug(r) === link.proof) ?? payload.proofs[0];
  const slug = proofSlug(record);
  const [cursor, setCursor] = useState<LspPos | null>(null);
  const [split, setSplitState] = useState<number | null>(storedSplit);
  const setSplit = (f: number | null) => {
    storeSplit(f);
    setSplitState(f);
  };
  const [highlight, setHighlight] = useState<SourceRange | null>(null);

  const proof = useMemo(
    () => ({ ...record.proof, proofId: slug }),
    [record, slug],
  );

  const editAt = useMemo(() => {
    const m = new Map(
      (proof.tacticEdits ?? []).map((e) => [
        `${e.stepStart.line}:${e.stepStart.character}`,
        e,
      ]),
    );
    return (p: { start: LspPos }) => m.get(`${p.start.line}:${p.start.character}`);
  }, [proof]);
  const infoAt = useMemo(
    () =>
      new Map(
        (proof.tokenInfos ?? []).map((i) => [
          `${i.start.line}:${i.start.character}`,
          i,
        ]),
      ),
    [proof],
  );
  const renderers = useMemo(
    () => makeTaggedRenderersWith(proof, proof.taggedGoals ?? [], codeOf),
    [proof],
  );
  const renderTaggedTactic = useMemo(
    () => makeTacticRendererWith(codeOf, editAt, infoAt),
    [editAt, infoAt],
  );
  const renderDeclHeader = useMemo(() => {
    const toks = proof.declHeaderTokens;
    const start = proof.declHeaderStart;
    const text = proof.declHeader ?? "";
    if (!toks || toks.length === 0 || !start || text === "") return undefined;
    return (lines: string[], label?: string, elision?: Elision) =>
      renderTacticTokensWith(
        codeOf,
        text,
        start,
        toks,
        label ?? text,
        lines,
        infoAt,
        elision,
      );
  }, [proof, infoAt]);
  const diagnostics = useMemo(
    () => filterDiagnostics(proof.diagnostics ?? [], proofSpan(proof)).kept,
    [proof],
  );

  // `»`: the step's TIGHT range where the payload has it (as the widget's
  // reveal takes it), else the step's own position. The cursor goes there
  // too, as the editor's caret does on a reveal.
  const reveal = (p: ProofStepPosition) => {
    const e = editAt(p);
    const at = e ? { start: e.start, stop: e.stop } : p;
    setHighlight({ start: at.start, stop: at.stop });
    setCursor(at.start);
    if (!paneOpen) setPaneOpen(true);
  };
  const revealHeader = proof.declHeaderStart
    ? () => {
        const start = proof.declHeaderStart!;
        const stop = proof.declHeaderBodyStop ?? proof.declHeaderSigStop ?? start;
        setHighlight({ start, stop });
        setCursor(start);
        if (!paneOpen) setPaneOpen(true);
      }
    : undefined;

  const select = (r: ViewerProof) => {
    setCursor(null);
    setHighlight(null);
    onLink({ ...link, proof: proofSlug(r) });
  };

  // The source's semantic tokens, every proof's, so the whole file is
  // painted with the server's own types wherever it had them.
  const tokens = useMemo(
    () =>
      payload.proofs.flatMap((r) => [
        ...(r.proof.tacticEdits ?? []).flatMap((e) => e.tokens ?? []),
        ...(r.proof.declHeaderTokens ?? []),
      ]),
    [payload],
  );

  const picker = (
    <select
      aria-label="Proof"
      value={slug}
      onChange={(e) => {
        const r = payload.proofs.find((x) => proofSlug(x) === e.target.value);
        if (r) select(r);
      }}
    >
      {payload.proofs.map((r) => (
        <option key={proofSlug(r)} value={proofSlug(r)}>
          {r.name ?? `example (line ${(r.proof.declRange?.start.line ?? 0) + 1})`}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {head(picker)}
      <div
        className="ptw-viewer-main"
        style={
          split === null
            ? undefined
            : ({ "--ptw-src-w": `${(split * 100).toFixed(2)}%` } as CSSProperties)
        }
      >
        <div className="ptw-viewer-tree">
          <WidgetBoundary resetKey={slug}>
            <ProofTreeView
              proof={proof}
              onReveal={reveal}
              tokenColors={TOKEN_PALETTE[kind]}
              highlightPos={cursor}
              declHeader={proof.declHeader}
              declHeaderStart={proof.declHeaderStart}
              declHeaderNameStop={proof.declHeaderNameStop}
              declHeaderSigStop={proof.declHeaderSigStop}
              declHeaderBodyStop={proof.declHeaderBodyStop}
              renderDeclHeader={renderDeclHeader}
              onRevealHeader={revealHeader}
              height="100%"
              renderTaggedGoal={renderers.renderTaggedGoal}
              renderTaggedHyps={renderers.renderTaggedHyps}
              renderTaggedTactic={renderTaggedTactic}
              diagnostics={diagnostics}
              experience={EXPERIENCE}
              initialView={{
                layout: link.layout,
                context: link.context,
                comments: link.comments,
              }}
              onViewState={onViewState}
            />
          </WidgetBoundary>
        </div>
        {paneOpen && (
          <div className="ptw-viewer-src">
            <SourcePane
              source={payload.source}
              tokens={tokens}
              cursor={cursor}
              highlight={highlight}
              declRange={proof.declRange ?? null}
              onCursor={(p) => {
                setHighlight(null);
                const other = proofAt(payload, p);
                if (other && proofSlug(other) !== slug) select(other);
                setCursor(p);
              }}
            />
          </div>
        )}
        {/* After the source in the DOM: both are order -1, so this is what
            puts the handle between the source and the tree. */}
        {paneOpen && <SplitHandle split={split} setSplit={setSplit} />}
      </div>
    </>
  );
}

export default function Viewer() {
  injectStyleOnce("ptw-viewer-page", PAGE_CSS);
  const [kind, toggleTheme] = useTheme();
  const narrow = useNarrow();
  const [link, setLink] = useState<ViewerLink>(() => parseLink(location.hash));
  const [paneOpen, setPaneOpen] = useState(() => window.innerWidth >= NARROW_PX);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; payload: ViewerPayload }
  >(() => {
    try {
      const inline = inlinePayload();
      return inline
        ? { kind: "ready", payload: checkPayload(inline) }
        : { kind: "loading" };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  });
  const inline = useMemo(() => !!document.getElementById("ramify-payload"), []);

  // Back/forward and an edited hash re-read the link.
  useEffect(() => {
    const on = () => setLink(parseLink(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const file = link.file;
  useEffect(() => {
    if (inline) return;
    if (!file) return;
    let live = true;
    fetch(`data/${encodeURIComponent(file)}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`No published file named “${file}” (${r.status}).`);
        return r.json();
      })
      .then((j) => live && setState({ kind: "ready", payload: checkPayload(j) }))
      .catch(
        (e: unknown) =>
          live &&
          setState({
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          }),
      );
    return () => {
      live = false;
    };
  }, [file, inline]);

  const onLink = useCallback((l: ViewerLink) => setLink(l), []);
  // The view reports its reading state; a value equal to the default is left
  // out of the link, so a plain link stays short. Stable, and a no-op when
  // nothing changed, so the view's report cannot loop through here.
  const onViewState = useCallback(
    (s: Pick<ViewerLink, "layout" | "context" | "comments">) =>
      setLink((prev) => {
        const next: ViewerLink = {
          ...prev,
          layout: s.layout === "stacked" ? undefined : s.layout,
          context: s.context === PRESETS[EXPERIENCE].context ? undefined : s.context,
          comments:
            s.comments === PRESETS[EXPERIENCE].comments ? undefined : s.comments,
        };
        return formatLink(next) === formatLink(prev) ? prev : next;
      }),
    [],
  );
  // The hash follows what is shown (an external system: no state is set
  // here), without a history entry per click.
  useEffect(() => {
    const h = formatLink(link);
    if (h !== location.hash)
      history.replaceState(null, "", h || location.pathname + location.search);
  }, [link]);

  const payload = state.kind === "ready" ? state.payload : null;
  const title = payload
    ? `${link.proof ?? payload.proofs[0]?.name ?? "proof"} · ${payload.file} — Ramify`
    : "Ramify";
  useEffect(() => {
    document.title = title;
  }, [title]);

  const head = (picker: ReactNode) => (
    <header className="ptw-viewer-head" {...chromeScopeProps()}>
      {!inline && (
        <a href="./" className="ptw-viewer-dim" title="Every published file">
          Ramify
        </a>
      )}
      {inline && <span className="ptw-viewer-dim">Ramify</span>}
      {payload && <span className="ptw-viewer-file">{payload.file}</span>}
      {picker}
      <span className="ptw-viewer-spacer" />
      <span
        className="ptw-viewer-note ptw-viewer-dim"
        style={{ fontSize: CHROME_TEXT_SM }}
        title="This page is for reading. In VS Code the same tree is live: edit in the tree, see diagnostics as you type, and restructure a proof with Lean checking each change."
      >
        For reading · in VS Code: edit in the tree, live diagnostics,
        restructuring checked by Lean
      </span>
      <a href={RELEASE_URL}>Get Ramify for VS Code</a>
      <a href={INSTALL_URL} className="ptw-viewer-dim ptw-viewer-install">
        install guide
      </a>
      <button
        type="button"
        aria-pressed={paneOpen}
        title={paneOpen ? "Hide the source" : "Show the source"}
        onClick={() => setPaneOpen(!paneOpen)}
      >
        Source
      </button>
      <button
        type="button"
        title={kind === "dark" ? "Use the light theme" : "Use the dark theme"}
        aria-label={kind === "dark" ? "Use the light theme" : "Use the dark theme"}
        onClick={toggleTheme}
      >
        {kind === "dark" ? "Light" : "Dark"}
      </button>
    </header>
  );

  return (
    <div
      className="ptw-viewer"
      data-narrow={narrow ? "" : undefined}
      {...chromeScopeProps()}
      data-ptw-theme={kind}
      style={Object.fromEntries(
        Object.entries(TOKEN_PALETTE[kind]).map(([k, v]) => [`--ptw-tok-${k}`, v]),
      )}
    >
      {state.kind === "ready" ? (
        <BakedPopups.Provider value={state.payload.hovers}>
          <ViewerBody
            payload={state.payload}
            link={link}
            kind={kind}
            head={head}
            paneOpen={paneOpen}
            setPaneOpen={setPaneOpen}
            onLink={onLink}
            onViewState={onViewState}
          />
        </BakedPopups.Provider>
      ) : (
        <>
          {head(null)}
          <div className="ptw-viewer-msg">
            {state.kind === "error" ? (
              <>
                <p>This proof could not be shown.</p>
                <p className="ptw-viewer-dim">{state.message}</p>
              </>
            ) : file ? (
              <p className="ptw-viewer-dim">Loading {file}…</p>
            ) : (
              <p>
                No file named in the link.{" "}
                <a href="./">See every published file</a>.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
