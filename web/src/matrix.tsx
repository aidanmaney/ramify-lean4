// The RENDER MATRIX (`/?matrix`): every paint-only mark crossed with every node
// kind and state, drawn by REAL `ProofTreeView`s so a visual regression is one
// screenshot review.  A review surface, not a product: nothing here is reached
// from the widget bundle, and the view is driven only through what the harness
// already has — props the view takes (`diagnostics`, `cfStub`, `polishDefault`,
// `onTrace`), source comments the parser already reads (`.mark`, `.fold`,
// `.none`, prose), and DOM events dispatched after mount, the way `window.__ptw`
// does.  Never a product-code flag.
//
// The grid: rows = node kinds, columns = states (matrixCells.ts, which also says
// why a cell is empty).  Below it, the status bar's three forms at three
// container widths, and complete proofs, optionally in all four layouts.
//   ?matrix                       the whole page
//   &theme=light|dark  &zoom=1|1.25|1.5   as the top controls
//   &kinds=tactic,fold  &states=plain,error   narrow the grid
//   &chrome            keep each view's status bar and rail (hidden by default)
//   &stack=mark,diag,kb,hover   narrow the "everything at once" column (bisecting)
//   &layouts           the complete proofs in all four layouts
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { parseNdjson, type Proof, type ProofRecord } from "./paperproof";
import type { TreeDiagnostic } from "./diagnostics";
import ProofTreeView, { type ProofTreeViewProps } from "./ProofTreeView";
import { WidgetBoundary } from "./errorBoundary";
import { KINDS, SKIPS, STATES, type KindDef, type StateDef } from "./matrixCells";
import { SCENES, subProof, type Above, type Built } from "./matrixScenes";
import type { PolishLine } from "./narrate";

const QUERY = new URLSearchParams(location.search);
/** `&stack=mark,diag,kb,hover` narrows what the "everything at once" column
 puts on a node — for bisecting which ingredient broke a cell. */
const STACK_PARTS = new Set((QUERY.get("stack") ?? "mark,comment,diag,seed,nub,kb,hover").split(","));
type Theme = "light" | "dark";

// ---- theme ------------------------------------------------------------------
// The real infoview sets `--vscode-*` on the document; the view reads the editor
// background to decide light or dark (theme.ts), so a "dark" page that only sets
// `color-scheme` is FAKE — the vars are what count.
const THEMES: Record<Theme, Record<string, string>> = {
  light: {
    "--vscode-editor-background": "#ffffff",
    "--vscode-editor-foreground": "#1f1f1f",
    "--vscode-editorWidget-background": "#f3f3f3",
    "--vscode-editorWidget-border": "#c8c8c8",
    "--vscode-foreground": "#3b3b3b",
  },
  dark: {
    "--vscode-editor-background": "#1e1e1e",
    "--vscode-editor-foreground": "#d4d4d4",
    "--vscode-editorWidget-background": "#252526",
    "--vscode-editorWidget-border": "#454545",
    "--vscode-foreground": "#cccccc",
  },
};

function applyTheme(t: Theme) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(THEMES[t])) root.style.setProperty(k, v);
  root.style.setProperty("color-scheme", t);
  document.body.style.background = "var(--vscode-editor-background)";
  document.body.style.color = "var(--vscode-editor-foreground)";
}
// At import, before any view mounts: a view reads its theme in `useState`.
const INITIAL_THEME: Theme = QUERY.get("theme") === "dark" ? "dark" : "light";
applyTheme(INITIAL_THEME);

// ---- DOM driver --------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fire(el: Element | Document | null, type: string, init: MouseEventInit = {}) {
  if (!el) return false;
  return el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, view: window, ...init }),
  );
}

type Target = KindDef["target"];

/** A scoped `window.__ptw`: every query starts at one cell's root, since a page
 of a hundred views repeats every node id a hundred times. */
function driver(root: HTMLElement) {
  const nodes = () => [...root.querySelectorAll<SVGGElement>("g[data-node]")];
  const nodeEl = (id: string) => nodes().find((g) => g.getAttribute("data-node") === id) ?? null;
  const resolve = (t: Target): string | null => {
    if ("id" in t) return t.id;
    return nodes().map((g) => g.getAttribute("data-node") ?? "").find((id) => id.startsWith(t.prefix)) ?? null;
  };
  const rect = (el: Element | null) => el?.getBoundingClientRect() ?? null;
  const frame = () => root.querySelector<HTMLElement>("[data-ptw-scroll]");
  const ctr = (r: DOMRect) => ({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  const api = {
    resolve,
    nodeEl,
    /** The pointer moves inside the box: the node's hover bar. */
    async hover(id: string) {
      const g = nodeEl(id);
      const r = rect(g?.querySelector("[data-ptw-box]") ?? null);
      if (!g || !r) return false;
      fire(g, "mouseover", ctr(r));
      fire(g, "mousemove", ctr(r));
      await sleep(120);
      return true;
    },
    /** The pointer leaves the node (its hover bar goes). */
    async unhover(id: string) {
      fire(nodeEl(id), "mouseout", { relatedTarget: document.body });
      await sleep(120);
    },
    async click(id: string, init: MouseEventInit = {}) {
      const g = nodeEl(id);
      fire(g, "click", init);
      await sleep(250);
      return !!g;
    },
    /** Click the bar button whose tip starts with `label` on a hovered node. */
    async bar(id: string, label: string) {
      await api.hover(id);
      const g = nodeEl(id);
      const b = [...(g?.querySelectorAll("[data-ptw-bar] [aria-label]") ?? [])].find((x) =>
        (x.getAttribute("aria-label") ?? "").startsWith(label),
      );
      if (!b) return false;
      fire(b, "click");
      await sleep(250);
      return true;
    },
    async corner(id: string) {
      const c = nodeEl(id)?.querySelector("[data-ptw-corner]") ?? null;
      fire(c, "click");
      await sleep(250);
      return !!c;
    },
    async nubHover(id: string) {
      const n = nodeEl(id)?.querySelector("[data-ptw-nub]") ?? null;
      const r = rect(n);
      if (!n || !r) return false;
      fire(n, "mouseover", ctr(r));
      fire(n, "mousemove", ctr(r));
      await sleep(120);
      return true;
    },
    async nubClick(id: string) {
      const n = nodeEl(id)?.querySelector("[data-ptw-nub]") ?? null;
      fire(n, "click");
      await sleep(250);
      return !!n;
    },
    /** A marquee drag from just outside the box's top-left to its centre — the
     view's own band-select, on `document` mouse events. */
    async select(id: string) {
      const g = nodeEl(id);
      const f = frame();
      const r = rect(g?.querySelector("[data-ptw-box]") ?? null);
      if (!g || !f || !r) return false;
      const sx = r.left - 6;
      const sy = r.top - 6;
      fire(f, "mousedown", { clientX: sx, clientY: sy, button: 0 });
      fire(document, "mousemove", { clientX: sx + 8, clientY: sy + 8 });
      fire(document, "mousemove", ctr(r));
      fire(document, "mouseup", ctr(r));
      await sleep(250);
      return true;
    },
    /** ArrowDown from Home until the arrows are on `id` — the keyboard ring. */
    async kb(id: string) {
      const f = frame();
      const g = nodeEl(id);
      if (!f || !g) return false;
      const key = (k: string) => {
        f.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
      };
      key("Home");
      await sleep(60);
      for (let i = 0; i < 40 && f.getAttribute("aria-activedescendant") !== g.id; i++) {
        key("ArrowDown");
        await sleep(40);
      }
      return f.getAttribute("aria-activedescendant") === g.id;
    },
    /** ⌥-click a status-bar item by the start of its tip, `times` over. */
    async altBar(label: string, times: number) {
      const b = [...root.querySelectorAll("button")].find((x) =>
        (x.getAttribute("aria-label") ?? "").startsWith(label),
      );
      if (!b) return false;
      for (let i = 0; i < times; i++) {
        fire(b, "click", { altKey: true });
        await sleep(120);
      }
      await sleep(250);
      return true;
    },
    /** Put the tree's top-left at the frame's top-left (36 px / 16 px in: room for a bar or a pill above the first box). The
     view centres a tree in a frame that is mostly its own scroll padding, so a
     small tree lands wherever the padding puts it; a cell is a window onto ONE
     node and wants it where a reviewer looks. Scroll only — nothing relays out. */
    async frameTree() {
      const f = frame();
      if (!f) return;
      const boxes = [...root.querySelectorAll("g[data-node] [data-ptw-box]")].map((b) => b.getBoundingClientRect());
      if (!boxes.length) return;
      const top = Math.min(...boxes.map((r) => r.top));
      const left = Math.min(...boxes.map((r) => r.left));
      const fr = f.getBoundingClientRect();
      f.scrollTo({ top: f.scrollTop + top - fr.top - 36, left: f.scrollLeft + left - fr.left - 16, behavior: "instant" });
      await sleep(80);
    },
    /** A rail button by tip. */
    async rail(label: string) {
      const b = [...root.querySelectorAll("button")].find((x) =>
        (x.getAttribute("aria-label") ?? "").startsWith(label),
      );
      fire(b ?? null, "click");
      await sleep(300);
      return !!b;
    },
    /** The ledger's rows: the clickable strips whose tip says "this step's goal". */
    ledgerRows(id: string): Element[] {
      const g = nodeEl(id);
      if (!g) return [];
      const viaTitle = [...g.querySelectorAll("title")]
        .filter((t) => (t.textContent ?? "").includes("this step's goal"))
        .map((t) => t.parentElement!)
        .filter(Boolean);
      return viaTitle.length ? viaTitle : [...g.querySelectorAll("[title*=\"this step's goal\"]")];
    },
    async row(id: string, i: number, init: MouseEventInit = {}) {
      const r = api.ledgerRows(id)[i];
      fire(r ?? null, "click", init);
      await sleep(250);
      return !!r;
    },
    async rowHover(id: string, i: number) {
      const r = api.ledgerRows(id)[i];
      fire(r ?? null, "mouseover");
      fire(r ?? null, "mouseenter");
      await sleep(120);
      return !!r;
    },
  };
  return api;
}
type Driver = ReturnType<typeof driver>;

// ---- scenes and plans ----------------------------------------------------------
const MESSAGES = {
  error: "The rfl tactic failed. Possible reasons: the goal is not a reflexive relation, or its two sides are not definitionally equal",
  warn: "declaration uses 'sorry'",
  lint: "This line exceeds the 100 character limit, please shorten your line! (linter: style.longLine)",
} as const;

function diagnosticsAt(built: Built, step: number, sev: "error" | "warn" | "lint"): TreeDiagnostic[] {
  const s = built.proof.steps[step];
  if (!s) return [];
  const range = { start: s.position.start, stop: s.position.stop };
  const severity = sev === "error" ? 1 : sev === "warn" ? 2 : 3;
  return [
    {
      severity,
      range,
      fullRange: range,
      message: MESSAGES[sev],
      ...(sev === "lint" ? { linter: "linter.style.longLine" } : {}),
    },
  ];
}

interface Corpus {
  byKey: Map<string, ProofRecord>;
}
const corpusKey = (file: string, index: number) => `${file}#${index}`;

function buildScene(kind: KindDef, above: Above, corpus: Corpus): Built | null {
  if (typeof kind.scene === "string") return SCENES[kind.scene].build(above);
  const rec = corpus.byKey.get(corpusKey(kind.scene.file, kind.scene.index));
  if (!rec) return null;
  const proof = subProof(rec.data.proof, kind.scene.at);
  return { proof, ids: {}, starts: [kind.scene.at], endLine: 0 };
}

interface Plan {
  built: Built;
  /** ms to wait after the drive before framing the tree a last time. */
  settle: number;
  props: Partial<ProofTreeViewProps>;
  drive: (d: Driver) => Promise<void>;
}

const POLISH = async (lines: PolishLine[]) =>
  lines.map((l) => ({
    nodeId: l.nodeId,
    text: l.template.charAt(0).toUpperCase() + l.template.slice(1) + (/[.!?]$/.test(l.template) ? "" : "."),
  }));

/** A cell's mount-time props and its post-mount drive. */
function planFor(kind: KindDef, state: StateDef, corpus: Corpus): Plan | null {
  const seeded = state.id === "seeded";
  const above: Above = {};
  const add = (step: number | null, lines: string[]) => {
    if (step === null) return;
    above[step] = [...(above[step] ?? []), ...lines];
  };
  const stack = state.id === "stack";
  // The author's cut is on the page: the reader's version of it is not drawn.
  const seedHere = seeded || (stack && STACK_PARTS.has("seed"));
  if (seedHere || kind.setup === "ghost") for (const [k, v] of Object.entries(kind.seedAbove ?? {})) add(Number(k), v);
  if (state.id === "marksrc" || (stack && STACK_PARTS.has("mark"))) add(kind.commentStep, [".mark"]);
  if ((state.id === "comment" || (stack && STACK_PARTS.has("comment"))) && !kind.seedAbove) add(kind.commentStep, ["Introduce the bound for `omega`."]);
  const built = buildScene(kind, above, corpus);
  if (!built) return null;
  const props: Partial<ProofTreeViewProps> = {};
  const sev = state.id === "error" || (stack && STACK_PARTS.has("diag")) ? "error" : state.id === "warn" ? "warn" : state.id === "lint" ? "lint" : null;
  // A seeded cut hides its steps; an error inside it is a separate question
  // (see the fold and hop rows' error cells), so the stack puts its error on the
  // first step, which stays drawn.
  const diagStep = stack && kind.seedAbove ? 0 : kind.diagStep;
  if (sev && diagStep !== null) props.diagnostics = diagnosticsAt(built, diagStep, sev);
  if (state.id === "polish") {
    props.polishReady = true;
    props.polishDefault = true;
    props.onPolish = POLISH;
  }
  if (kind.setup === "trace") {
    props.onTrace = async () => true;
    // `⁇` is on the beginner preset's bar, not the default one.
    props.hoverBar = { tactic: ["source", "trace", "skip", "path", "delete"] };
  }
  if (kind.setup === "stub")
    // The server re-elaborates with the broken line spliced to `sorry`, so the
    // tree holds a `sorry` step there and the stub is painted over it.
    props.cfStub = { line: built.starts[1].line, pos: built.starts[1], draft: "rw [Nat.zero_add]", col: 2 };

  const drive = async (d: Driver) => {
    // 1. what makes the kind
    const t = kind.target;
    const tactic = typeof kind.scene === "string" ? built.ids.tactic : null;
    if (kind.setup === "fold" && !seedHere) await d.corner(d.resolve(t)!);
    if (kind.setup === "hop" && !seedHere && tactic) await d.click(tactic, { altKey: true });
    if (kind.setup === "trace" && tactic) {
      await d.bar(tactic, "Show what");
      await d.unhover(tactic);
    }
    // 2. the state
    const id = d.resolve(t);
    if (!id) return;
    switch (state.id) {
      case "selected": await d.select(id); break;
      case "armed": await d.bar(id, "Delete this"); break;
      case "kbfocus": await d.kb(id); break;
      case "marktmp": await d.nubClick(id); break;
      case "nub": await d.nubHover(id); break;
      case "bar": await d.hover(id); break;
      case "narrate": await d.altBar("Comments", 3); break;
      case "polish": await d.altBar("Comments", 3); break;
      case "rowopen": await d.row(id, 0); break;
      case "stack":
        // Marks first (the corner nub is only there while the node has no tab),
        // then the keys, then the pointer — each leaves the others standing.
        if (STACK_PARTS.has("nub") && kind.commentStep === null && kind.id !== "ghost") await d.nubClick(id);
        if (STACK_PARTS.has("kb")) await d.kb(id);
        if (STACK_PARTS.has("hover")) await d.hover(id);
        break;
    }
    if (kind.id === "row" && state.id === "bar") await d.rowHover(id, 0);
  };
  return { built, props, drive, settle: state.id === "kbfocus" || stack ? 900 : 100 };
}

// ---- the view, with the stubs every cell shares ---------------------------------
function viewProps(proof: Proof, extra: Partial<ProofTreeViewProps>): ProofTreeViewProps {
  const slots = proof.deleteSlots ?? [];
  return {
    proof,
    ledger: true,
    deleteSlots: slots,
    getTacticEdit: (p) => {
      const slot = slots.find((s) => s.start.line === p.start.line && s.start.character === p.start.character);
      const step = proof.steps.find(
        (s) => s.position.start.line === p.start.line && s.position.start.character === p.start.character,
      );
      return {
        pos: slot ? { start: slot.start, stop: slot.stop } : p,
        text: step?.tacticString ?? "«stub tactic»",
        indent: p.start.character,
      };
    },
    onEditTactic: () => {},
    onDeleteTactic: () => {},
    onReveal: () => {},
    onApplyRewrite: () => {},
    ...extra,
  };
}

const CELL_W = 340;

function Cell({ kind, state, corpus, chrome, onDone }: {
  kind: KindDef;
  state: StateDef;
  corpus: Corpus;
  chrome: boolean;
  onDone: () => void;
}) {
  const [plan] = useState(() => planFor(kind, state, corpus));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!plan || !root) return;
    let live = true;
    void (async () => {
      await sleep(700);
      if (!live) return;
      const d = driver(root);
      await d.frameTree();
      if (live) await plan.drive(d);
      // The keyboard's own scroll is eased; frame again once it has landed.
      if (live) await sleep(plan.settle);
      if (live) await d.frameTree();
      if (live) onDone();
    })();
    return () => {
      live = false;
    };
  }, [plan, onDone]);
  if (!plan) return <Empty text="record missing" />;
  return (
    <div
      ref={ref}
      data-cell={`${kind.id}/${state.id}`}
      className={chrome ? undefined : "mx-nochrome"}
      style={{ width: CELL_W, height: kind.height, position: "relative", overflow: "hidden", borderRadius: 3 }}
    >
      <WidgetBoundary resetKey={`${kind.id}/${state.id}`}>
        <ProofTreeView {...viewProps(plan.built.proof, plan.props)} height={kind.height} />
      </WidgetBoundary>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        width: CELL_W,
        height: "100%",
        minHeight: 40,
        boxSizing: "border-box",
        padding: 8,
        fontSize: 11,
        opacity: 0.55,
        display: "flex",
        alignItems: "center",
        border: "1px dashed color-mix(in srgb, currentColor 30%, transparent)",
        borderRadius: 3,
      }}
      title={text}
    >
      skipped: {text}
    </div>
  );
}

// ---- the status bar's three forms ----------------------------------------------
// `fit` (statusBar.tsx) picks the form from the container width alone, so three
// frames of different widths show the all-words, names-shed and glyph forms.  The
// proof carries a source mark and a diagnostic so the Marks and count items are
// in the row.
const BAR_WIDTHS: { w: number; label: string }[] = [
  { w: 760, label: "760 px — words" },
  { w: 520, label: "520 px — names shed" },
  { w: 330, label: "330 px — glyphs" },
];

function BarForms({ corpus }: { corpus: Corpus }) {
  const kind = KINDS[0];
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      {BAR_WIDTHS.map(({ w, label }) => (
        <BarForm key={w} w={w} label={label} kind={kind} corpus={corpus} />
      ))}
    </div>
  );
}

function BarForm({ w, label, kind, corpus }: { w: number; label: string; kind: KindDef; corpus: Corpus }) {
  const [built] = useState(() => buildScene(kind, { 0: [".mark"] }, corpus)!);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    void (async () => {
      await sleep(700);
      if (live) await driver(root).frameTree();
    })();
    return () => {
      live = false;
    };
  }, []);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 12, marginBottom: 4 }}>{label}</figcaption>
      <div ref={ref} style={{ width: w, height: 230, position: "relative", overflow: "hidden", borderRadius: 3 }}>
        <WidgetBoundary resetKey={label}>
          <ProofTreeView
            {...viewProps(built.proof, { diagnostics: diagnosticsAt(built, 0, "warn") })}
            height={230}
          />
        </WidgetBoundary>
      </div>
    </figure>
  );
}

// ---- complete proofs, in the four layouts ---------------------------------------
const COMPLETE: { file: string; index: number }[] = [
  { file: "proofs/hyp_used.lean", index: 1 },
  { file: "proofs/side_goals.lean", index: 2 },
  { file: "proofs/flags.lean", index: 2 },
  { file: "proofs/sample.lean", index: 1 },
];
const LAYOUT_NAMES = ["outline", "spine", "tracks", "wide"];

function Complete({ rec, layoutIx, chrome }: { rec: ProofRecord; layoutIx: number; chrome: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    void (async () => {
      await sleep(500);
      if (!live) return;
      const d = driver(root);
      if (layoutIx > 0) await d.altBar("Layout", layoutIx);
      if (live) await d.rail("Fit width");
    })();
    return () => {
      live = false;
    };
  }, [layoutIx]);
  return (
    <div
      ref={ref}
      className={chrome ? undefined : "mx-nochrome"}
      style={{ width: 460, height: 400, position: "relative", overflow: "hidden", borderRadius: 3 }}
    >
      <WidgetBoundary resetKey={`${rec.file}${rec.data.index}${layoutIx}`}>
        <ProofTreeView {...viewProps(rec.data.proof, {})} height={400} />
      </WidgetBoundary>
    </div>
  );
}

// ---- the page --------------------------------------------------------------------
const CSS = `
.mx-nochrome [data-ptw-theme] > [style*="z-index: 10"],
.mx-nochrome [data-ptw-theme] > [style*="z-index: 12"] { display: none !important; }
.mx-page { font: 12px/1.35 system-ui, sans-serif; padding: 0 16px 48px; text-align: left; }
.mx-page h2 { font-size: 13px; margin: 28px 0 8px; }
.mx-top { position: sticky; top: 0; z-index: 100; display: flex; gap: 18px; align-items: center; flex-wrap: wrap;
  padding: 8px 16px; margin: 0 -16px 8px; background: var(--vscode-editor-background);
  border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent); }
.mx-top label { display: inline-flex; gap: 5px; align-items: center; }
.mx-grid { display: grid; gap: 8px 10px; width: max-content; }
.mx-colhead { position: sticky; top: 38px; z-index: 50; background: var(--vscode-editor-background); font-weight: 600;
  padding: 4px 2px; align-self: end; }
.mx-rowhead { position: sticky; left: 0; z-index: 40; background: var(--vscode-editor-background); font-weight: 600;
  padding-right: 8px; width: 112px; align-self: start; }
.mx-rowhead small { display: block; font-weight: 400; opacity: 0.6; }
/* Chrome's CSS zoom and position: sticky disagree about where "left: 0" is. */
.mx-zoomed .mx-rowhead { position: static; }
.mx-cellbox { outline: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
`;

function csvParam(name: string): string[] | null {
  const v = QUERY.get(name);
  return v ? v.split(",") : null;
}

export default function Matrix() {
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const [theme, setTheme] = useState<Theme>(INITIAL_THEME);
  const [zoom, setZoom] = useState(Number(QUERY.get("zoom")) || 1);
  const [layouts, setLayouts] = useState(QUERY.has("layouts"));
  const [chrome, setChrome] = useState(QUERY.has("chrome"));
  const [done, setDone] = useState(0);
  // `window.__matrix`: the page's one driver hook, for a screenshot session.
  // `go(kind, state)` scrolls a cell to the top-left under the sticky headers;
  // `ready()` says every cell has been driven; `texts(kind, state)` is what the
  // cell draws, one entry per node.
  useEffect(() => {
    const cell = (k: string, s: string) => document.querySelector<HTMLElement>(`[data-cell="${k}/${s}"]`);
    (window as unknown as { __matrix: unknown }).__matrix = {
      go: (k: string, s: string) => {
        const r = cell(k, s)?.getBoundingClientRect();
        if (!r) return false;
        // Offsets are read off the page, not assumed: they scale with the zoom.
        const head = document.querySelector(".mx-rowhead")?.getBoundingClientRect().width ?? 112;
        const top = (document.querySelector(".mx-top")?.getBoundingClientRect().height ?? 40) +
          (document.querySelector(".mx-colhead")?.getBoundingClientRect().height ?? 24);
        window.scrollTo(r.left + scrollX - head - 10, r.top + scrollY - top - 8);
        return true;
      },
      ready: () => document.querySelector(".mx-page")?.getAttribute("data-matrix-ready") === "1",
      texts: (k: string, s: string) =>
        [...(cell(k, s)?.querySelectorAll("g[data-node]") ?? [])].map((g) => `${g.getAttribute("data-node")}: ${(g.textContent ?? "").slice(0, 60)}`),
    };
  }, []);

  const markDone = useCallback(() => setDone((d) => d + 1), []);

  useEffect(() => {
    void fetch(`${import.meta.env.BASE_URL}sample.ndjson`)
      .then((r) => r.text())
      .then((text) => {
        const byKey = new Map<string, ProofRecord>();
        for (const r of parseNdjson(text)) byKey.set(corpusKey(r.file, r.data.index), r);
        setCorpus({ byKey });
      });
  }, []);

  const kinds = KINDS.filter((k) => !csvParam("kinds") || csvParam("kinds")!.includes(k.id));
  const states = STATES.filter((s) => !csvParam("states") || csvParam("states")!.includes(s.id));
  const drawn = kinds.flatMap((k) => states.map((s) => ({ k, s }))).filter(({ k, s }) => !SKIPS[`${k.id}/${s.id}`]);
  const ready = corpus !== null && done >= drawn.length;

  const setParam = (k: string, v: string | null) => {
    const q = new URLSearchParams(location.search);
    if (v === null) q.delete(k);
    else q.set(k, v);
    history.replaceState(null, "", `?${q.toString().replace(/=(&|$)/g, "$1")}`);
  };

  if (!corpus) return <div style={{ padding: 16 }}>Loading the corpus…</div>;

  // Zoom is CSS on the grid and applies only once every cell has been driven:
  // the drivers read client rects, and the view's marquee maths divides by its
  // OWN zoom, not the page's.
  const gridStyle: CSSProperties = { gridTemplateColumns: `112px repeat(${states.length}, ${CELL_W}px)` };
  return (
    <div className={zoom !== 1 && ready ? "mx-page mx-zoomed" : "mx-page"} data-matrix-ready={ready ? "1" : "0"}>
      <style>{CSS}</style>
      <div className="mx-top">
        <strong>Render matrix</strong>
        <label>
          theme
          <select
            value={theme}
            onChange={(e) => {
              const t = e.target.value as Theme;
              applyTheme(t);
              setTheme(t);
              setDone(0);
              setParam("theme", t);
            }}
          >
            <option value="light">light</option>
            <option value="dark">dark</option>
          </select>
        </label>
        <label>
          zoom
          <select
            value={zoom}
            onChange={(e) => {
              setZoom(Number(e.target.value));
              setParam("zoom", e.target.value);
            }}
          >
            {[1, 1.25, 1.5].map((z) => (
              <option key={z} value={z}>
                {z}×
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={layouts}
            onChange={(e) => {
              setLayouts(e.target.checked);
              setParam("layouts", e.target.checked ? "" : null);
            }}
          />
          all four layouts
        </label>
        <label>
          <input
            type="checkbox"
            checked={chrome}
            onChange={(e) => {
              setChrome(e.target.checked);
              setParam("chrome", e.target.checked ? "" : null);
            }}
          />
          show each view's bar and rail
        </label>
        <span style={{ opacity: 0.6 }}>
          {done}/{drawn.length} cells driven{ready ? " — ready" : ""}
        </span>
      </div>

      <div style={{ zoom: ready ? zoom : 1 }}>
        <h2>Marks × node kinds and states</h2>
        <div className="mx-grid" style={gridStyle}>
          <div />
          {states.map((s) => (
            <div key={s.id} className="mx-colhead" title={s.how}>
              {s.label}
            </div>
          ))}
          {kinds.map((k) => (
            <KindRow key={`${theme}:${k.id}`} kind={k} states={states} corpus={corpus} chrome={chrome} onDone={markDone} />
          ))}
        </div>

        <h2>Status bar — three forms at three container widths (a warning and a source mark in the proof)</h2>
        <BarForms key={theme} corpus={corpus} />

        <h2>Complete proofs{layouts ? " — outline · spine · tracks · wide" : " — outline (tick “all four layouts” for the rest)"}</h2>
        <div className="mx-grid" style={{ gridTemplateColumns: `112px repeat(${layouts ? 4 : 1}, 460px)` }}>
          <div />
          {LAYOUT_NAMES.slice(0, layouts ? 4 : 1).map((n) => (
            <div key={n} className="mx-colhead" style={{ top: 0, position: "static" }}>
              {n}
            </div>
          ))}
          {COMPLETE.map((c) => {
            const rec = corpus.byKey.get(corpusKey(c.file, c.index));
            return (
              <CompleteRow key={`${theme}:${c.file}${c.index}`} rec={rec} label={`${c.file.replace("proofs/", "")} #${c.index}`} layouts={layouts ? 4 : 1} chrome={chrome} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KindRow({ kind, states, corpus, chrome, onDone }: {
  kind: KindDef;
  states: StateDef[];
  corpus: Corpus;
  chrome: boolean;
  onDone: () => void;
}) {
  return (
    <>
      <div className="mx-rowhead" title={kind.note}>
        {kind.label}
        <small>{kind.note}</small>
      </div>
      {states.map((s) => {
        const why = SKIPS[`${kind.id}/${s.id}`];
        return why ? (
          <div key={s.id} style={{ height: 44 }}>
            <Empty text={why} />
          </div>
        ) : (
          <div key={s.id} className="mx-cellbox">
            <Cell kind={kind} state={s} corpus={corpus} chrome={chrome} onDone={onDone} />
          </div>
        );
      })}
    </>
  );
}

function CompleteRow({ rec, label, layouts, chrome }: { rec: ProofRecord | undefined; label: string; layouts: number; chrome: boolean }) {
  return (
    <>
      <div className="mx-rowhead">{label}</div>
      {Array.from({ length: layouts }, (_, i) => (
        <div key={i} className="mx-cellbox">
          {rec ? <Complete rec={rec} layoutIx={i} chrome={chrome} /> : <Empty text="record missing" />}
        </div>
      ))}
    </>
  );
}

