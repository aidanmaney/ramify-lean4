// THE BAKED PLAYGROUND — type a tactic under an open goal, watch the tree grow.
//
// No Lean server: `lean/PlaygroundBake.lean` ran every (goal, tactic) answer
// a visitor is likely to ask for through real Lean, once, and
// `scripts/publish.mjs --playground` ships one table per theorem
// (`playground/<name>.json`, `playgroundVersion: 1`). Everything a visitor
// sees — goals, errors, hovers — is what Lean said.
//
//   typed text ──play()──▶ baked step ──buildProof()──▶ records ──▶ ProofTreeView
//
// The view is the static viewer's, fed the same way (BakedCode, BakedPopups,
// viewerTheme), with NO edit hooks — every Lean-only move is absent through
// `caps`/`availability` exactly as on the viewer — and ONE narrow hook,
// `onTryTactic`: the frontier `+` chip opens the in-place editor and its
// commit comes here. The bottom bar is the same question for a phone (or a
// reader who would rather not aim at a chip): a goal, a line, Try.
//
// The seam to a future live Lean is `answer` (playgroundAnswer.ts); see
// docs/playground-spike.md "Levelling up".
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ProofTreeView from "./ProofTreeView";
import { BakedCode } from "./bakedCode";
import { BakedPopups } from "./bakedPopups";
import { filterDiagnostics, proofSpan } from "./diagnostics";
import { WidgetBoundary } from "./errorBoundary";
import { parseAppearance } from "./appearance";
import { parseExperience } from "./experience";
import {
  NOT_BAKED,
  bakedEngine,
  buildProof,
  checkBake,
  completions,
  loadTable,
  makeAnswer,
  play,
  type Attempt,
  type OpenGoal,
  type Play,
  type Table,
} from "./playgroundAnswer";
import { injectStyleOnce, makeTaggedRenderersWith } from "./taggedCore";
import type { TaggedText } from "./taggedText";
import {
  CHROME_BORDER,
  CHROME_FONT,
  CHROME_INK,
  CHROME_RADIUS,
  CHROME_TEXT,
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
const RELEASE_URL = "https://github.com/aidanmaney/ramify-lean4/releases/latest";
const NARROW_PX = 700;
/** Where the reader starts: the WHOLE context. The view's `used` default
 shows what the next step used — and an open goal has no next step yet, so it
 would show the visitor nothing they could use. */
const START_VIEW = { context: "full" } as const;

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
.ptw-pg button { cursor: pointer; }
.ptw-pg button:disabled { opacity: ${DISABLED_OPACITY}; cursor: default; }
.ptw-pg a { color: inherit; }
.ptw-pg-dim { opacity: ${DIM_OPACITY}; }
.ptw-pg-spacer { flex: 1 1 0; }
.ptw-pg-head select { min-width: 0; max-width: 260px; flex: 0 1 auto; }
.ptw-pg-intro {
  padding: 8px 12px; font-size: ${CHROME_TEXT}px; line-height: 1.45;
  border-bottom: 1px solid ${CHROME_BORDER}; color: ${CHROME_INK};
}
.ptw-pg-intro b { font-weight: 600; }
.ptw-pg code, .ptw-pg-mono { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.ptw-pg-tree { flex: 1 1 auto; min-height: 0; position: relative; }
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
.ptw-pg-msg[data-kind=error] { color: var(--ptw-danger, inherit); }
.ptw-pg-msg[data-kind=done] { color: var(--ptw-ok, inherit); }
.ptw-pg-done { font-weight: 600; }
.ptw-pg-chips { display: flex; flex-wrap: wrap; gap: 6px; max-height: 96px; overflow: auto; }
.ptw-pg-chips button {
  font-family: var(--vscode-editor-font-family); font-size: 12px; padding: 2px 8px;
}
.ptw-pg-chips button:hover, .ptw-pg button:not(:disabled):hover { background: var(--ptw-chrome-lit); }
.ptw-pg-msgbox { padding: 24px; font-size: ${CHROME_TEXT}px; max-width: 640px; line-height: 1.5; }
.ptw-pg[data-narrow] .ptw-pg-head { gap: 8px; padding: 6px 10px; }
.ptw-pg[data-narrow] .ptw-pg-head select { flex: 1 1 160px; max-width: none; }
.ptw-pg[data-narrow] .ptw-pg-wide { display: none; }
.ptw-pg[data-narrow] .ptw-pg-intro { padding: 6px 10px; }
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

/** What the bar says after an attempt. */
type Said =
  | { kind: "error"; label: string; error: string }
  | { kind: typeof NOT_BAKED; label: string; completions: string[]; frontier: boolean }
  | null;

const goalLabel = (g: OpenGoal, i: number, n: number) =>
  `${n > 1 ? `${i + 1}/${n} · ` : ""}${g.caseName ? `${g.caseName}: ` : ""}⊢ ${g.target}`;

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
  const answer = useMemo(() => makeAnswer([bakedEngine(table)]), [table]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [said, setSaid] = useState<Said>(null);
  const [typed, setTyped] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const [showBaked, setShowBaked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const built = useMemo(
    () => buildProof(table, attempts, `playground:${entry.name}`),
    [table, attempts, entry.name],
  );
  // The goal the bar targets: the reader's pick while it is open, else the
  // first open goal (Lean's main goal).
  const target = built.open.find((g) => g.nodeId === pick) ?? built.open[0] ?? null;

  const renderers = useMemo(
    () => makeTaggedRenderersWith(built.proof, built.proof.taggedGoals, codeOf),
    [built],
  );
  const diagnostics = useMemo(
    () => filterDiagnostics(built.diagnostics, proofSpan(built.proof)).kept,
    [built],
  );

  const tryOn = useCallback(
    async (g: OpenGoal, text: string) => {
      if (text.trim() === "") return;
      const r: Play = await play(table, answer, g.state, g.aliases, text);
      if (r.kind === NOT_BAKED) {
        setPick(g.nodeId);
        setTyped(r.label);
        setSaid(r);
        return;
      }
      setAttempts((a) => [...a, { occ: g.occ, play: r }]);
      setTyped("");
      setShowBaked(false);
      setSaid(r.kind === "error" ? r : null);
      // a failed attempt keeps its goal targeted (its retry copy)
      setPick(r.kind === "error" ? `${g.occ}~` : null);
    },
    [table, answer],
  );

  // The view's `+` chip: the goal it was drawn on, by node id.
  const onTryTactic = useCallback(
    (goalId: string, text: string) => {
      const g = built.open.find((o) => o.nodeId === goalId);
      if (g) void tryOn(g, text);
    },
    [built, tryOn],
  );
  const getGoalTactics = useCallback(
    (goalId: string) => {
      const g = built.open.find((o) => o.nodeId === goalId);
      return g ? completions(table, g.state, g.aliases) : [];
    },
    [built, table],
  );

  const undo = () => {
    setAttempts((a) => a.slice(0, -1));
    setSaid(null);
    setPick(null);
  };
  const reset = () => {
    setAttempts([]);
    setSaid(null);
    setPick(null);
    setTyped("");
  };

  const baked = target ? completions(table, target.state, target.aliases) : [];
  const listed =
    said?.kind === NOT_BAKED ? said.completions : showBaked ? baked : null;
  const nOpen = built.open.length;

  return (
    <>
      {head(
        <>
          <button type="button" onClick={undo} disabled={attempts.length === 0} title="Take back the last tactic">
            Undo
          </button>
          <button type="button" onClick={reset} disabled={attempts.length === 0} title="Start this theorem again">
            Reset
          </button>
        </>,
      )}
      <div className="ptw-pg-intro">
        <b>{entry.title}.</b> {blurbNodes(entry.blurb)}
      </div>
      <div className="ptw-pg-tree">
        {/* the bake's popups plus the renamed copies the visitor's names mint */}
        <BakedPopups.Provider value={built.hovers}>
        <WidgetBoundary resetKey={entry.name}>
          <ProofTreeView
            proof={built.proof}
            tokenColors={TOKEN_PALETTE[kind]}
            declHeader={built.proof.declHeader}
            declHeaderStart={built.proof.declHeaderStart}
            highlightPos={built.cursor}
            height="100%"
            renderTaggedGoal={renderers.renderTaggedGoal}
            renderTaggedHyps={renderers.renderTaggedHyps}
            diagnostics={diagnostics}
            experience={EXPERIENCE}
            appearance={APPEARANCE}
            initialView={START_VIEW}
            onTryTactic={onTryTactic}
            getGoalTactics={getGoalTactics}
          />
        </WidgetBoundary>
        </BakedPopups.Provider>
      </div>
      <form
        className="ptw-pg-try"
        onSubmit={(e) => {
          e.preventDefault();
          if (target) void tryOn(target, typed);
        }}
      >
        {target ? (
          <div className="ptw-pg-row">
            {nOpen > 1 ? (
              <select
                aria-label="The goal to work on"
                className="ptw-pg-mono"
                value={target.nodeId}
                onChange={(e) => {
                  setPick(e.target.value);
                  setSaid(null);
                }}
              >
                {built.open.map((g, i) => (
                  <option key={g.nodeId} value={g.nodeId}>
                    {goalLabel(g, i, nOpen)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="ptw-pg-mono ptw-pg-dim" style={{ flex: "0 1 38%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {goalLabel(target, 0, 1)}
              </span>
            )}
            <input
              ref={inputRef}
              aria-label="A tactic for this goal"
              placeholder="Type a tactic, e.g. intro n"
              value={typed}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button type="submit" disabled={typed.trim() === ""}>
              Try
            </button>
          </div>
        ) : null}
        <div
          className="ptw-pg-msg"
          role="status"
          data-kind={
            said?.kind === "error" ? "error" : built.closed ? "done" : undefined
          }
        >
          {said?.kind === "error" ? (
            <span title={said.error}>
              Lean: <code>{said.label}</code> —{" "}
              {said.error.split("\n")[0]}{" "}
              <span className="ptw-pg-dim">
                (the whole message is on the squiggle). The goal is still
                open: try again below it, or Undo.
              </span>
            </span>
          ) : said?.kind === NOT_BAKED ? (
            <span>
              <code>{said.label}</code> is not in this demo
              {said.frontier
                ? " — the demo was not explored past this goal. Undo, or try another route."
                : said.completions.length > 0
                  ? ". Lean's answers here were computed in advance for:"
                  : "."}
            </span>
          ) : built.closed ? (
            <span>
              <span className="ptw-pg-done">Proof complete.</span>{" "}
              <span className="ptw-pg-dim">
                Every goal and error above is what Lean said.{" "}
                <a href={RELEASE_URL}>Get Ramify for VS Code</a> to write your own.
              </span>
            </span>
          ) : (
            <span className="ptw-pg-dim">
              {nOpen === 1 ? "1 goal open" : `${nOpen} goals open`} — type a
              tactic below, or use <code>+</code> under a goal in the tree.{" "}
              <button
                type="button"
                onClick={() => setShowBaked((v) => !v)}
                aria-expanded={showBaked}
                disabled={baked.length === 0}
              >
                {showBaked ? "Hide hints" : "Hints"}
              </button>
            </span>
          )}
        </div>
        {listed && listed.length > 0 && target && (
          <div className="ptw-pg-chips" aria-label="Tactics with an answer here">
            {listed.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => void tryOn(target, c)}
                title={`Try ${c}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </form>
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
    const h = `#t=${encodeURIComponent(want)}`;
    if (location.hash !== h) history.replaceState(null, "", h);
    document.title = `${entry?.title ?? want} — Ramify playground`;
  }, [want, entry]);
  useEffect(() => {
    const on = () => setName(new URLSearchParams(location.hash.slice(1)).get("t"));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  const head = (extra: ReactNode) => (
    <header className="ptw-pg-head" {...chromeScopeProps()}>
      <a href="./" className="ptw-pg-dim" title="Every published proof">
        Ramify
      </a>
      <span>Playground</span>
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
      <a
        className="ptw-pg-wide"
        href={RELEASE_URL}
        title="Here every answer was computed in advance. In VS Code the same tree is live: any tactic, checked as you type."
      >
        Get Ramify for VS Code
      </a>
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
