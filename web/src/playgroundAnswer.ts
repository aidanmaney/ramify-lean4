// THE BAKED PLAYGROUND's answers — pure, offline-probeable (`probe playground`).
//
// `lean/PlaygroundBake.lean` ran every (goal, tactic) a visitor is likely to
// type through real Lean, once, and shipped the table (`playgroundVersion: 1`).
// This module is everything between the table and the UNCHANGED tree:
//
//   typed text ──play()──▶ a baked step | Lean's error | "not baked" + completions
//   attempts   ──buildProof()──▶ Paperproof-shaped steps + sidecars ──proofToTree──▶ tree
//
// THE SEAM is one async function, `answer(goalKey, tactic)` (an `Engine`):
// engines are tried in order and the first answer that is not `NOT_BAKED`
// wins. Goals are named by their KEY — the infoview's own print, case tag +
// hypotheses + `⊢ target` — never a bake-local id, so a later engine (a WASM
// Lean, docs/playground-spike.md "Levelling up") whose goals print the same
// JOINS the baked graph. Everything visitor-facing (normalisation, name
// aliasing, completions) sits above the seam, in `play`.
//
// NAMES. The bake is canonical: one spelling per binder (`intro n`, `h`,
// `h_1`, `rename_i n ih`). Any identifier a step INTRODUCES — a name present
// in a goal it leaves and absent from the goal it starts from — may be spelled
// differently by the visitor; the alias (canonical → shown) rides that goal's
// subtree, the visitor's later text is read back through it, and the tree
// shows the visitor's spelling: renamed on the TAGGED print (a tag whose popup
// is the bare name, i.e. a local), the plain print being read off the renamed
// tagged one, so the two cannot disagree. Lean's error texts and the popups'
// strings are renamed word-by-word (they are plain text).
import { AbbreviationProvider } from "@leanprover/unicode-input";
import type { RawDiagnostic } from "./diagnostics";
import type {
  GoalInfo,
  HypOrigin,
  Hypothesis,
  Proof,
  ProofStep,
  ProofStepPosition,
  RecoveredStep,
} from "./paperproof";
import type { TaggedGoalEntryOf } from "./taggedCore";
import { flattenTaggedText, type TaggedText } from "./taggedText";
import type { BakedPopup, BakedTag } from "./viewerPayload";

export const PLAYGROUND_VERSION = 1;
export const NOT_BAKED = "not baked" as const;
export type NotBaked = typeof NOT_BAKED;

// ------------------------------------------------------------- the format

type Code = TaggedText<BakedTag>;

export interface BakedHyp {
  names: string[];
  fvarIds?: string[];
  type: Code;
  val?: Code;
}

/** `ProofTree.bakeGoal`'s goal: the infoview's `InteractiveGoal`, popups baked. */
export interface BakedGoal {
  hyps: BakedHyp[];
  type: Code;
  goalPrefix?: string;
  mvarId?: string;
  userName?: string;
}

export interface BakedState {
  goal: BakedGoal;
  /** `mayBeProof` per hypothesis NAME, flattened in order. */
  kinds: string[];
  /** Not explored: the depth cap, or only a probe step reached it. */
  frontier?: boolean;
}

/** `[goal, tactic, children, uses?]` or `[goal, tactic, {e: errorIndex}]`. */
export type BakedStepRow =
  | [number, string, number[], string[]?]
  | [number, string, { e: number }];

export interface PlaygroundBake {
  playgroundVersion: number;
  theorem: string;
  statement: string;
  depth: number;
  solution: string[];
  goals: BakedState[];
  steps: BakedStepRow[];
  errors: string[];
  hovers: BakedPopup[];
  /** Added by publish.mjs from the file's `/-! # Title … -/` block. */
  title?: string;
  blurb?: string;
  file?: string;
}

/** The bake this page reads, or a sentence a reader can act on. */
export function checkBake(j: unknown): PlaygroundBake {
  const b = j as Partial<PlaygroundBake> | null;
  if (!b || typeof b !== "object")
    throw new Error("This playground file is not JSON the page understands.");
  if (b.playgroundVersion !== PLAYGROUND_VERSION)
    throw new Error(
      `This playground file is format ${String(b.playgroundVersion)}; this page reads format ${PLAYGROUND_VERSION}. Reload to fetch the matching page.`,
    );
  if (
    !Array.isArray(b.goals) ||
    !Array.isArray(b.steps) ||
    !Array.isArray(b.errors) ||
    !Array.isArray(b.hovers) ||
    b.goals.length === 0
  )
    throw new Error("The playground file is missing its goals, steps or hovers.");
  return b as PlaygroundBake;
}

// --------------------------------------------------------------- the table

export type Outcome = { goals: number[]; uses: string[] } | { error: string };

export interface Table {
  bake: PlaygroundBake;
  /** Each state's key (`goalKey`), by id. */
  keys: string[];
  byKey: Map<string, number>;
  /** Per state: canonical tactic → outcome, in bake order. */
  steps: Map<number, Map<string, Outcome>>;
}

/** The names a hypothesis bundle stands for, with their kinds. */
const flatHyps = (g: BakedGoal) =>
  g.hyps.flatMap((b) => b.names.map((n, i) => ({ name: n, bundle: b, i })));

/** A state's KEY: the infoview's print — `case` tag, hypotheses grouped as
 it groups them, `⊢ target`. What joins answers from different engines. */
export function goalKey(g: BakedGoal): string {
  const lines: string[] = [];
  if (g.userName) lines.push(`case ${g.userName}`);
  for (const h of g.hyps) lines.push(`${h.names.join(" ")} : ${flattenTaggedText(h.type)}`);
  lines.push(`${g.goalPrefix ?? "⊢ "}${flattenTaggedText(g.type)}`);
  return lines.join("\n");
}

export function loadTable(bake: PlaygroundBake): Table {
  const keys = bake.goals.map((s) => goalKey(s.goal));
  const byKey = new Map(keys.map((k, i) => [k, i]));
  const steps = new Map<number, Map<string, Outcome>>();
  for (const row of bake.steps) {
    const [gid, tac, out] = row;
    let m = steps.get(gid);
    if (!m) steps.set(gid, (m = new Map()));
    m.set(
      tac,
      Array.isArray(out)
        ? { goals: out, uses: (row[3] as string[] | undefined) ?? [] }
        : { error: bake.errors[out.e] ?? "error" },
    );
  }
  return { bake, keys, byKey, steps };
}

// ----------------------------------------------------------------- the seam

export type EngineAnswer =
  | { goals: string[]; uses: string[] }
  | { error: string }
  | NotBaked;

/** ONE async function: a goal (by key) and a tactic in the bake's own
 spelling → the goals left (by key), Lean's error, or `NOT_BAKED`. */
export type Engine = (goalKey: string, tactic: string) => Promise<EngineAnswer>;

/** The baked engine: an exact table lookup. */
export function bakedEngine(t: Table): Engine {
  return async (key, tactic) => {
    const id = t.byKey.get(key);
    if (id === undefined) return NOT_BAKED;
    const o = t.steps.get(id)?.get(tactic);
    if (!o) return NOT_BAKED;
    return "error" in o
      ? { error: o.error }
      : { goals: o.goals.map((g) => t.keys[g]), uses: o.uses };
  };
}

/** The seam: engines in order, the first answer that is not `NOT_BAKED`
 wins. A live engine slots in AFTER the baked one, answering in the same
 shape with goals keyed the same way. */
export function makeAnswer(engines: Engine[]): Engine {
  return async (key, tactic) => {
    for (const e of engines) {
      const a = await e(key, tactic);
      if (a !== NOT_BAKED) return a;
    }
    return NOT_BAKED;
  };
}

// ------------------------------------------------------------- typed text

let abbrev: AbbreviationProvider | null = null;
/** `\to` → `→`, `\<` → `⟨`, …: the editor's own abbreviation table (the
 longest abbreviation that has a replacement wins, as the input method's
 eager replacement does). */
export function expandAbbreviations(s: string): string {
  if (!s.includes("\\")) return s;
  abbrev ??= new AbbreviationProvider({
    abbreviationCharacter: "\\",
    customTranslations: {},
    eagerReplacementEnabled: true,
  });
  const p = abbrev;
  return s.replace(/\\([^\s\\]+)/g, (whole, body: string) => {
    for (let n = body.length; n > 0; n--) {
      const r = p.getReplacementText(body.slice(0, n));
      if (r !== undefined) return r + body.slice(n);
    }
    return whole;
  });
}

/** One identifier-ish run (Lean names, numerals, `?_`, `simp?`) or one
 other character; whitespace only separates. */
const TOKEN = /[\p{L}\p{N}_'.!?✝₀-₉]+|\S/gu;
const IDENT = /^[\p{L}_][\p{L}\p{N}_'.!?✝₀-₉]*$/u;

export const tokens = (s: string): string[] => s.match(TOKEN) ?? [];

/** What the visitor typed, as the bake spells it: abbreviations expanded and
 whitespace collapsed. The table is then matched TOKEN by token, so `n+1`
 and `n + 1`, `[ h ]` and `[h]` are one tactic. */
export const normalise = (s: string): string =>
  expandAbbreviations(s).trim().replace(/\s+/g, " ");

// ------------------------------------------------------------------ aliases

/** canonical → shown, for one goal occurrence's subtree. */
export type Aliases = ReadonlyArray<readonly [string, string]>;

const escRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Rename whole words (a Lean identifier is not a word inside another). */
export function renameWords(s: string, map: ReadonlyMap<string, string>): string {
  if (map.size === 0) return s;
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_'.✝])(?:${keys.map(escRe).join("|")})(?![\\p{L}\\p{N}_'✝])`,
    "gu",
  );
  return s.replace(re, (w) => map.get(w) ?? w);
}

const shownMap = (a: Aliases) => new Map(a.map(([c, s]) => [c, s]));
const canonMap = (a: Aliases) => new Map(a.map(([c, s]) => [s, c]));

/** The names a state shows, canonical. */
const stateNames = (t: Table, id: number) =>
  flatHyps(t.bake.goals[id].goal).map((h) => h.name);

/** (name, type) pairs a state's context holds — what "introduced" compares. */
const stateHypKeys = (t: Table, id: number) =>
  new Set(
    flatHyps(t.bake.goals[id].goal).map(
      (h) => `${h.name}\u0000${flattenTaggedText(h.bundle.type)}`,
    ),
  );

/** The names a step INTRODUCES: in a goal it leaves, not in its own. */
function introduced(t: Table, from: number, to: number[]): Set<string> {
  const before = stateHypKeys(t, from);
  const out = new Set<string>();
  for (const c of to)
    for (const h of flatHyps(t.bake.goals[c].goal))
      if (!before.has(`${h.name}\u0000${flattenTaggedText(h.bundle.type)}`))
        out.add(h.name);
  return out;
}

// --------------------------------------------------------------------- play

export type Play =
  | {
      kind: "ok";
      /** The baked spelling. */
      tactic: string;
      /** What the tree shows: the visitor's text, normalised. */
      label: string;
      goals: number[];
      uses: string[];
      /** The aliases the goals it leaves carry. */
      aliases: Aliases;
    }
  | { kind: "error"; tactic: string; label: string; error: string }
  | {
      kind: typeof NOT_BAKED;
      label: string;
      /** Every tactic baked as SUCCEEDING here, in the visitor's names. */
      completions: string[];
      /** The demo was not explored past this goal. */
      frontier: boolean;
    };

/** Every tactic that succeeds on this state, shown through the aliases. */
export function completions(t: Table, state: number, aliases: Aliases): string[] {
  const m = t.steps.get(state);
  if (!m) return [];
  const show = shownMap(aliases);
  const out: string[] = [];
  for (const [tac, o] of m)
    if (!("error" in o)) out.push(show.size ? renameWords(tac, show) : tac);
  return out;
}

/** Resolve one typed line on one goal occurrence (`state`, seen through
 `aliases`), asking `answer` for the outcome. */
export async function play(
  t: Table,
  answer: Engine,
  state: number,
  aliases: Aliases,
  typed: string,
): Promise<Play> {
  const label = normalise(typed);
  const toCanon = canonMap(aliases);
  const typedToks = tokens(label).map((w) => (IDENT.test(w) ? (toCanon.get(w) ?? w) : w));
  const key = t.keys[state];
  const notBaked = (): Play => ({
    kind: NOT_BAKED,
    label,
    completions: completions(t, state, aliases),
    frontier: !!t.bake.goals[state].frontier,
  });
  if (typedToks.length === 0) return notBaked();
  const baked = [...(t.steps.get(state) ?? new Map<string, Outcome>())];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  // 1. the bake's own spelling, read through the aliases
  let pick: { tactic: string; renames: Map<string, string> } | null = null;
  for (const [tac] of baked)
    if (same(tokens(tac), typedToks)) {
      pick = { tactic: tac, renames: new Map() };
      break;
    }
  // 2. the same tactic with the names it INTRODUCES spelled the visitor's way
  if (!pick)
    for (const [tac, o] of baked) {
      if ("error" in o) continue;
      const bt = tokens(tac);
      if (bt.length !== typedToks.length) continue;
      const intro = introduced(t, state, o.goals);
      const renames = new Map<string, string>();
      let ok = true;
      for (let i = 0; i < bt.length && ok; i++) {
        if (bt[i] === typedToks[i]) continue;
        if (!intro.has(bt[i]) || !IDENT.test(typedToks[i])) ok = false;
        else if ((renames.get(bt[i]) ?? typedToks[i]) !== typedToks[i]) ok = false;
        else renames.set(bt[i], typedToks[i]);
      }
      if (!ok || renames.size === 0) continue;
      // one shown name per hypothesis: a new spelling may not be a name
      // any goal it leaves already shows for another hypothesis
      const shown = new Set(renames.values());
      if (shown.size !== renames.size) continue;
      const show = shownMap(aliases);
      const clash = o.goals.some((c) =>
        stateNames(t, c).some(
          (n) => !renames.has(n) && shown.has(show.get(n) ?? n),
        ),
      );
      if (clash) continue;
      pick = { tactic: tac, renames };
      break;
    }
  if (!pick) return notBaked();

  const a = await answer(key, pick.tactic);
  if (a === NOT_BAKED) return notBaked();
  if ("error" in a)
    return {
      kind: "error",
      tactic: pick.tactic,
      label,
      error: renameWords(a.error, shownMap(aliases)),
    };
  // the visitor's names override whatever alias a re-introduced name had
  const next = new Map(aliases.map(([c, s]) => [c, s] as [string, string]));
  for (const [c, s] of pick.renames) next.set(c, s);
  for (const c of pick.renames.keys()) if (next.get(c) === c) next.delete(c);
  const goals = a.goals.map((k) => t.byKey.get(k));
  if (goals.some((g) => g === undefined)) return notBaked();
  return {
    kind: "ok",
    tactic: pick.tactic,
    label,
    goals: goals as number[],
    uses: a.uses,
    aliases: [...next],
  };
}

// ------------------------------------------------------ attempts → a Proof

/** One line the visitor ran: on which goal OCCURRENCE, and Lean's answer. A
 failed attempt stays drawn until the next attempt on that goal replaces it. */
export interface Attempt {
  occ: string;
  play: Extract<Play, { kind: "ok" } | { kind: "error" }>;
}

export interface OpenGoal {
  /** The goal node this pending goal is drawn as. */
  nodeId: string;
  /** The occurrence an attempt on it targets (a failed attempt's retry copy
   targets the goal the attempt failed on). */
  occ: string;
  state: number;
  aliases: Aliases;
  /** The goal's target as shown, for a picker. */
  target: string;
  caseName?: string;
  /** The last attempt on it failed. */
  failed: boolean;
  frontier: boolean;
}

export interface Built {
  proof: Proof & { taggedGoals: TaggedGoalEntryOf<BakedTag>[] };
  diagnostics: RawDiagnostic[];
  /** The bake's popups plus the renamed copies minted for aliases. */
  hovers: BakedPopup[];
  open: OpenGoal[];
  /** Every goal closed and no failed attempt standing. */
  closed: boolean;
  /** The proof as Lean source (the visitor's spelling, `·` per extra goal). */
  source: string;
  /** Where the LAST attempt's step sits: the view's cursor, so the tree
   follows each new step as it follows the editor's caret. */
  cursor: { line: number; character: number } | null;
}

interface Occ {
  state: number;
  aliases: Aliases;
  /** `shown name\0type` → hypothesis id, for this occurrence. */
  hypIds: Map<string, string>;
}

const ROOT = "g0";

/** Replay the attempts into Paperproof-shaped records the UNCHANGED
 `proofToTree` reads: each step `goalBefore → tactic → goalsAfter`, goal and
 hypothesis ids minted per OCCURRENCE (a baked state can recur in one tree),
 positions from the tree's own preorder (so sibling order is the goals'
 order, not the typing order), a failed attempt as the recovery parser's
 `failed` step with Lean's error as its diagnostic and a retry copy of its
 goal below it, the tagged goals renamed to the visitor's names. */
export function buildProof(t: Table, attempts: readonly Attempt[], theoremId: string): Built {
  const hovers: BakedPopup[] = [...t.bake.hovers];
  const renamedPopup = new Map<string, number>();
  let hypN = 0;
  let occN = 1;
  const occs = new Map<string, Occ>();
  const mintHyps = (state: number, aliases: Aliases, parent?: Occ) => {
    const show = shownMap(aliases);
    const ids = new Map<string, string>();
    for (const h of flatHyps(t.bake.goals[state].goal)) {
      const k = `${show.get(h.name) ?? h.name}\u0000${renameWords(flattenTaggedText(h.bundle.type), show)}`;
      ids.set(k, parent?.hypIds.get(k) ?? `h${hypN++}`);
    }
    return ids;
  };
  occs.set(ROOT, { state: 0, aliases: [], hypIds: mintHyps(0, []) });

  // the last attempt on each occurrence is its step; a success mints children
  const last = new Map<string, number>();
  const children = new Map<number, string[]>();
  attempts.forEach((a, i) => {
    const o = occs.get(a.occ);
    if (!o) return;
    last.set(a.occ, i);
    if (a.play.kind === "ok") {
      const p = a.play;
      const ids = p.goals.map((state) => {
        const id = `g${occN++}`;
        occs.set(id, { state, aliases: p.aliases, hypIds: mintHyps(state, p.aliases, o) });
        return id;
      });
      children.set(i, ids);
    }
  });

  // --- the renamed print
  const renameCode = (c: Code, show: Map<string, string>): Code => {
    if (show.size === 0) return c;
    if ("text" in c) return c;
    if ("append" in c) return { append: c.append.map((x) => renameCode(x, show)) };
    const [tag, inner] = c.tag;
    const pop = t.bake.hovers[tag.h] ?? {};
    let h = tag.h;
    const ex = pop.expr && renameWords(pop.expr, show);
    const ty = pop.type && renameWords(pop.type, show);
    if (ex !== pop.expr || ty !== pop.type) {
      const k = `${tag.h}\u0000${ex}\u0000${ty}`;
      let n = renamedPopup.get(k);
      if (n === undefined) {
        n = hovers.length;
        hovers.push({ ...pop, expr: ex, type: ty });
        renamedPopup.set(k, n);
      }
      h = n;
    }
    // a LOCAL: the tag's popup is the bare name, and so is its text
    const local =
      "text" in inner && pop.expr === inner.text && show.has(inner.text);
    return {
      tag: [
        { ...tag, h },
        local ? { text: show.get((inner as { text: string }).text)! } : renameCode(inner, show),
      ],
    };
  };

  const tagged: TaggedGoalEntryOf<BakedTag>[] = [];
  const infoCache = new Map<string, GoalInfo>();
  const infoOf = (occId: string): GoalInfo => {
    const hit = infoCache.get(occId);
    if (hit) return hit;
    const goalId = occId;
    const o = occs.get(occId)!;
    const st = t.bake.goals[o.state];
    const show = shownMap(o.aliases);
    const hyps: Hypothesis[] = [];
    let k = 0;
    const bundles = st.goal.hyps.map((b) => {
      const type = renameCode(b.type, show);
      const text = flattenTaggedText(type);
      const fvarIds: string[] = [];
      for (const n of b.names) {
        const shown = show.get(n) ?? n;
        const id = o.hypIds.get(`${shown}\u0000${text}`) ?? `h${hypN++}`;
        fvarIds.push(id);
        hyps.push({ username: shown, type: text, value: null, id, isProof: st.kinds[k++] ?? "data" });
      }
      return { ...b, names: b.names.map((n) => show.get(n) ?? n), fvarIds, type };
    });
    const type = renameCode(st.goal.type, show);
    tagged.push({ goalId, goal: { ...st.goal, hyps: bundles, type } });
    const info: GoalInfo = {
      username: st.goal.userName ?? "[anonymous]",
      type: flattenTaggedText(type),
      hyps,
      id: goalId,
    };
    infoCache.set(occId, info);
    return info;
  };

  // --- the tree, in preorder: positions follow the goals' order
  const steps: ProofStep[] = [];
  const recovered: RecoveredStep[] = [];
  const diagnostics: RawDiagnostic[] = [];
  const open: OpenGoal[] = [];
  const src: string[] = [];
  let line = 1;
  let rootInfo: GoalInfo | null = null;
  let cursor: Built["cursor"] = null;
  // the source: a pending goal is `sorry` (so the text is Lean that checks up
  // to the visitor's names), a failed attempt is left out (its goal is open)
  const emit = (lead: string | undefined, indent: number, text: string) =>
    src.push((lead ?? " ".repeat(indent)) + text);
  const walk = (occId: string, indent: number, lead?: string) => {
    const info = infoOf(occId);
    if (occId === ROOT) rootInfo = info;
    const o = occs.get(occId)!;
    const i = last.get(occId);
    const pending = (nodeId: string, failed: boolean) =>
      open.push({
        nodeId,
        occ: occId,
        state: o.state,
        aliases: o.aliases,
        target: info.type,
        caseName: t.bake.goals[o.state].goal.userName,
        failed,
        frontier: !!t.bake.goals[o.state].frontier,
      });
    if (i === undefined) {
      pending(occId, false);
      emit(lead, indent, "sorry");
      return;
    }
    const a = attempts[i];
    const at = { line: line++, character: indent };
    if (i === attempts.length - 1) cursor = at;
    const position: ProofStepPosition = {
      start: at,
      stop: { line: at.line, character: indent + a.play.label.length },
    };
    const byName = new Map(info.hyps.map((h) => [h.username, h.id]));
    const show = shownMap(o.aliases);
    if (a.play.kind === "error") {
      const copyId = `${occId}~`;
      const copy = { ...info, id: copyId };
      tagged.push({ ...tagged.find((e) => e.goalId === occId)!, goalId: copyId });
      steps.push({
        tacticString: a.play.label,
        goalBefore: info,
        goalsAfter: [copy],
        spawnedGoals: [],
        tacticDependsOn: [],
        position,
        theorems: [],
      });
      recovered.push({ start: at, kind: "failed" });
      diagnostics.push({ range: position, fullRange: position, severity: 1, message: a.play.error });
      pending(copyId, true);
      emit(lead, indent, "sorry");
      return;
    }
    emit(lead, indent, a.play.label);
    const kids = children.get(i) ?? [];
    const kidInfos = kids.map((k) => infoOf(k));
    steps.push({
      tacticString: a.play.label,
      goalBefore: info,
      goalsAfter: kidInfos,
      spawnedGoals: [],
      tacticDependsOn: a.play.uses
        .map((u) => byName.get(show.get(u) ?? u))
        .filter((x): x is string => !!x),
      position,
      theorems: [],
    });
    // more than one goal left: each is a `·` block, as Lean's style has it
    const bullet = kids.length > 1;
    for (const k of kids) {
      walk(k, bullet ? indent + 2 : indent, bullet ? `${" ".repeat(indent)}· ` : undefined);
    }
  };
  walk(ROOT, 2);

  // B2 — where each hypothesis came from: the first step whose goals-after
  // hold an id its goal-before does not (a pure post-pass, as the server's)
  const hypOrigins: HypOrigin[] = [];
  const seen = new Set<string>(rootInfo!.hyps.map((h) => h.id));
  for (const s of steps) {
    const before = new Set(s.goalBefore.hyps.map((h) => h.id));
    for (const g of s.goalsAfter)
      for (const h of g.hyps)
        if (!before.has(h.id) && !seen.has(h.id)) {
          seen.add(h.id);
          hypOrigins.push({ id: h.id, username: h.username, start: s.position.start });
        }
  }

  const header = `theorem ${t.bake.theorem} : ${t.bake.statement} := by`;
  const proof: Built["proof"] = {
    steps,
    allGoals: [rootInfo!],
    recovered,
    hypOrigins,
    taggedGoals: tagged,
    proofId: theoremId,
    declRange: { start: { line: 0, character: 0 }, stop: { line, character: 0 } },
    declHeader: header,
    declHeaderStart: { line: 0, character: 0 },
    ...(steps.length === 0
      ? { openBlock: { goal: rootInfo!, anchor: { line: 1, character: 2 }, indent: 2 } }
      : {}),
  };
  return {
    proof,
    diagnostics,
    hovers,
    open,
    closed: attempts.length > 0 && open.length === 0,
    source: [header, ...src].join("\n"),
    cursor,
  };
}
