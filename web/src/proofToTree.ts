import type {
  CalcChain,
  TermLedger,
  Hole,
  CalcRelOption,
  CalcRelations,
  GoalInfo,
  Hypothesis,
  OpenBlock,
  Proof,
  ProofStep,
  ProofStepPosition,
  SourceComment,
  TacticSlot,
  BranchInfo,
  BranchArm,
} from "./paperproof";
import { stepGoalsAfter } from "./paperproof";
import type {
  AddSpec,
  DeleteSpec,
  HypLine,
  LedgerRow,
  NodeFlags,
  TreeNode,
} from "./types";
import { collapseLabel } from "./briefLabel";
import { tacticHead } from "./elide";

/** Where a hypothesis line came from, resolved to something the view can draw:
    the id of the introducing TACTIC NODE, that tactic's head word, and the
    editor line it sits on. */
export interface HypOriginRef {
  origin: string;
  originText: string;
  originLine: number;
}

const EMPTY_CTX: ReadonlySet<string> = new Set<string>();

const TACTIC_PREFIX = "tactic:";

const CALC_RELS = new Set([
  "=", "≤", "<", "≥", ">", "≠", "∣", "⊆", "⊂", "↔", "≡", "≈", "∼", "⊑",
]);
const SPINE_TOKENS = new Set([...CALC_RELS, "∧", "∨", "→", "¬"]);
const BINDER_HEADS = new Set(["∀", "∃", "fun", "λ"]);
const OPENERS = "([{⟨⦃";
const CLOSERS = ")]}⟩⦄";

export function spineRelation(
  type: string,
): { rel: string; lhs: string; rhs: string } | null {
  if (BINDER_HEADS.has(type.trimStart().split(/\s+/)[0] ?? "")) return null;
  const spine: { tok: string; start: number }[] = [];
  let depth = 0;
  let i = 0;
  while (i < type.length) {
    while (i < type.length && /\s/.test(type[i])) i++;
    if (i >= type.length) break;
    const start = i;
    const atDepth = depth;
    while (i < type.length && !/\s/.test(type[i])) {
      if (OPENERS.includes(type[i])) depth++;
      else if (CLOSERS.includes(type[i])) depth--;
      i++;
    }
    const tok = type.slice(start, i);
    if (atDepth === 0 && SPINE_TOKENS.has(tok)) spine.push({ tok, start });
  }
  if (spine.length !== 1 || !CALC_RELS.has(spine[0].tok)) return null;
  const { tok, start } = spine[0];
  return {
    rel: tok,
    lhs: type.slice(0, start).trimEnd(),
    rhs: type.slice(start + tok.length).trim(),
  };
}

function chainLhsElisions(
  links: { id: string; type: string }[],
  consumed: string | undefined,
): Map<string, string> {
  const parts = links.flatMap((g) => {
    const r = spineRelation(g.type);
    return r ? [{ id: g.id, lhs: r.lhs, rhs: r.rhs }] : [];
  });
  const head = consumed ? spineRelation(consumed)?.lhs : undefined;
  const out = new Map<string, string>();
  for (const p of parts)
    if (p.lhs !== head && parts.some((q) => q !== p && q.rhs === p.lhs))
      out.set(p.id, p.lhs);
  return out;
}
export const tacticId = (goalId: string): string =>
  `${TACTIC_PREFIX}${goalId}`;

export const TURNSTILE = "⊢ ";

export function hypLine(h: Hypothesis): string {
  return h.value != null
    ? `${h.username} : ${h.type} := ${h.value}`
    : `${h.username} : ${h.type}`;
}

export type HypMode = "used" | "new" | "delta" | "full";

function contextFor(
  goal: GoalInfo,
  consumedBy: ProofStep | undefined,
  producedBy: ProofStep | undefined,
  mode: HypMode,

  flags?: ParsedFlags,

  deepUsed?: Map<string, string>,

  group = false,

  inherited?: ReadonlySet<string>,

  originOf?: (h: Hypothesis) => HypOriginRef | undefined,
): HypLine[] {
  if (flags?.noHyps) return [];
  const used = new Set(consumedBy?.tacticDependsOn ?? []);

  const deltaOf = () => {
    const inherited = new Set(producedBy?.goalBefore.hyps.map((h) => h.id));
    return goal.hyps.filter((h) => !inherited.has(h.id) || used.has(h.id));
  };
  let shown = goal.hyps;
  if (mode === "used") {
    if (!consumedBy) shown = deltaOf();
    else {
      const deep = deepUsed ?? new Map<string, string>();
      const ownIds = new Set(goal.hyps.map((h) => h.id));
      const fallbackNames = new Set<string>();
      for (const [id, name] of deep)
        if (!ownIds.has(id) && name) fallbackNames.add(name);
      shown = goal.hyps.filter(
        (h) => deep.has(h.id) || fallbackNames.has(h.username),
      );
    }
  } else if (mode === "new") {
    if (!producedBy) shown = [];
    else {
      const inherited = new Set(producedBy.goalBefore.hyps.map((h) => h.id));
      shown = goal.hyps.filter((h) => !inherited.has(h.id));
    }
  } else if (mode === "delta") {
    shown = deltaOf();
  }

  if (inherited?.size && mode !== "full")
    shown = shown.filter((h) => !inherited.has(hypLine(h)));

  if (flags?.onlyHyps?.length)
    shown = shown.filter((h) => flags.onlyHyps!.includes(h.username));

  if (!group)
    return shown.map((h) => ({
      text: hypLine(h),
      used: used.has(h.id),
      hypName: h.username,
      hypType: h.type,
      ...originOf?.(h),
    }));
  const data = shown.filter((h) => h.isProof !== "proof");
  const props = shown.filter((h) => h.isProof === "proof");
  return [...data, ...props].map((h, i) => ({
    text: hypLine(h),
    used: used.has(h.id),
    hypName: h.username,
    hypType: h.type,
    ...originOf?.(h),
    sep: data.length > 0 && props.length > 0 && i === data.length
      ? true
      : undefined,
  }));
}

const IDENT_CH = /[A-Za-z0-9_']/;

export function mvarOccurrences(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "?") continue;
    if (i > 0 && IDENT_CH.test(s[i - 1])) continue;
    if (i + 1 < s.length && IDENT_CH.test(s[i + 1])) n++;
  }
  return n;
}

function goalIndex(proof: Proof): Map<string, GoalInfo> {
  const goals = new Map<string, GoalInfo>();
  const score = new Map<string, number>();
  const offer = (g: GoalInfo) => {
    const s = mvarOccurrences(g.type);
    const cur = score.get(g.id);
    if (cur === undefined || s < cur) {
      goals.set(g.id, g);
      score.set(g.id, s);
    }
  };
  for (const g of proof.allGoals) offer(g);
  for (const step of proof.steps) {
    for (const g of [step.goalBefore, ...stepGoalsAfter(step)]) offer(g);
  }
  return goals;
}

export function rootIds(proof: Proof): string[] {
  const produced = new Set<string>();
  for (const step of proof.steps) {
    for (const g of stepGoalsAfter(step)) produced.add(g.id);
  }
  const open = proof.openBlock ? [proof.openBlock.goal.id] : [];
  return [...open, ...proof.steps.map((s) => s.goalBefore.id)].filter(
    (id, i, arr) => arr.indexOf(id) === i && !produced.has(id),
  );
}

export function proofTitle(proof: Proof): string {
  const goals = goalIndex(proof);
  const root = rootIds(proof)[0];
  return (root && goals.get(root)?.type) || "(proof)";
}

function caseName(goal: GoalInfo | undefined): string | undefined {
  const raw = goal?.username;
  if (!raw) return undefined;
  const name = raw.split("._@.")[0].trim();
  if (name === "" || name === "[anonymous]" || name === "_") return undefined;
  return name;
}

/** The case badge's text: the goal's own tag, plus what B5's arm says the
    branch bound there — the pattern the author wrote (`inl ⟨k, hk⟩`) where
    there is one, else the names (`succ k ih`). A badge is only ever GROWN,
    never minted, so no goal gains a line of chrome it did not already have. */
function armLabel(base: string | undefined, arm?: BranchArm): string | undefined {
  if (!base || !arm) return base;
  const extra = arm.pattern ?? (arm.binders.length ? arm.binders.join(" ") : "");
  return extra === "" || extra === base ? base : `${base} ${extra}`;
}

export const posLE = (a: LspPos, b: LspPos) => cmpPos(a, b) <= 0;

/** The one spelling of a POSITION AS A KEY — `<line>:<character>`. Every
 sidecar is filed under a step's own start (`traceKey`, the slot table, the
 fold's parts), so the string that keys them is written once and every reader
 of it agrees by construction. */
export const posKey = (p: LspPos) => `${p.line}:${p.character}`;

export function positionContains(r: ProofStepPosition, p: LspPos): boolean {
  return posLE(r.start, p) && !posLE(r.stop, p);
}

export function tacticTargets(
  nodes: TreeNode[],
): { id: string; position: ProofStepPosition }[] {
  return nodes.flatMap((d) => {
    const parts = d.elidedCut?.parts;
    if (parts)
      return parts
        .filter((p) => p.position)
        .map((p) => ({ id: d.id, position: p.position! }));
    return d.type === "tactic" && d.position
      ? [{ id: d.id, position: d.position }]
      : [];
  });
}

export function tacticNodeAt(
  tactics: { id: string; position: ProofStepPosition }[],
  p: LspPos,
): string | null {
  const onLine = tactics.filter((t) => t.position.start.line === p.line);
  if (onLine.length > 0) {
    let best: (typeof tactics)[number] | null = null;
    for (const t of onLine)
      if (
        cmpPos(t.position.start, p) <= 0 &&
        (!best || cmpPos(best.position.start, t.position.start) < 0)
      )
        best = t;
    if (!best)
      for (const t of onLine)
        if (!best || cmpPos(t.position.start, best.position.start) < 0) best = t;
    return best!.id;
  }
  const span = (r: ProofStepPosition) =>
    (r.stop.line - r.start.line) * 1e4 + (r.stop.character - r.start.character);
  let inner: (typeof tactics)[number] | null = null;
  for (const t of tactics)
    if (
      positionContains(t.position, p) &&
      (!inner || span(t.position) < span(inner.position))
    )
      inner = t;
  if (!inner) return null;

  let prior: (typeof tactics)[number] | null = null;
  for (const t of tactics) {
    if (t === inner) continue;
    if (cmpPos(t.position.start, inner.position.start) <= 0) continue;
    if (!posLE(t.position.stop, p)) continue;
    if (!prior || cmpPos(prior.position.stop, t.position.stop) < 0) prior = t;
  }
  return (prior ?? inner).id;
}

type LspPos = { line: number; character: number };

export const cmpPos = (a: LspPos, b: LspPos): number =>
  a.line - b.line || a.character - b.character;

const NBSP = " ";

export function cleanMarkdown(
  text: string,
  opts?: { breakableCode?: boolean },
): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, (_, code: string) =>
      opts?.breakableCode ? code : code.replace(/ /g, NBSP),
    );
}

function stripCommentText(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("--")) t = t.slice(2);
  else if (t.startsWith("/-")) {
    t = t.replace(/^\/-[-!]?/, "");
    t = t.replace(/-\/$/, "");
  }
  const lines = t.split("\n").map((l) => l.trim());
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const paras: string[] = [];
  let para: string[] = [];
  for (const l of lines) {
    if (l === "") {
      if (para.length) paras.push(para.join(" "));
      para = [];
    } else para.push(l);
  }
  if (para.length) paras.push(para.join(" "));

  return paras.join("\n\n");
}

interface ParsedFlags {
  fold?: boolean;
  elide?: boolean;
  noHyps?: boolean;

  /** A TOUR STOP the author dropped: `true` for a bare `.mark` (ranked by
   source position), a positive integer for `.mark 3` (an explicit rank, which
   sorts before every bare one). See `tour.ts` for the ordering. */
  mark?: number | true;

  onlyHyps?: string[];

  prose: string;

  any: boolean;
}

export const FLAG_RE = /^\.([a-zA-Z][\w-]*)(?:#(\S+))?$/;

export function parseFlags(text: string): ParsedFlags {
  const out: ParsedFlags = { prose: text, any: false };

  const [head, ...rest] = text.split("\n");
  const words = head.split(/\s+/);
  let i = 0;
  for (; i < words.length; i++) {
    const m = FLAG_RE.exec(words[i]);
    if (!m) break;
    const [, name, arg] = m;
    switch (name) {
      case "fold":
        out.fold = true;
        break;
      case "unfold":

        out.fold = false;
        break;
      case "none":
        out.elide = true;
        break;
      case "no-hyps":
        out.noHyps = true;
        break;
      case "mark": {
        // The ONE flag with a bare-word argument: `.mark 3`. The flag loop
        // stops at the first word that is not a flag, so the rank has to be
        // eaten here or it would end the run and fall into the prose.
        const next = words[i + 1];
        if (next !== undefined && /^[1-9]\d*$/.test(next)) {
          out.mark = Number(next);
          i++;
        } else out.mark = true;
        break;
      }
      case "h":
        if (arg) out.onlyHyps = [...(out.onlyHyps ?? []), arg];
        break;
      default:

        break;
    }
    out.any = true;
  }
  if (!out.any) return out;
  out.prose = [words.slice(i).join(" "), ...rest].join("\n").trim();
  return out;
}

function nodeFlags(
  f: ParsedFlags | undefined,
  targets: string[],

  selfElide = false,
): NodeFlags | undefined {
  if (!f) return undefined;
  const fold = !!f.fold && targets.length > 0;
  const elide = !!f.elide && (selfElide || targets.length > 0);
  if (!fold && !elide && f.mark === undefined) return undefined;
  const out: NodeFlags = { targets };
  if (fold) out.fold = true;
  if (elide) out.elide = true;
  // A `.mark` needs no target: it names THIS node as a tour stop.
  if (f.mark !== undefined) out.mark = f.mark;

  if (elide && f.prose) out.note = f.prose;
  return out;
}

const isDocComment = (c: SourceComment) => c.text.startsWith("/--");

function attributeComments(
  comments: SourceComment[],
  steps: ProofStep[],
  rootId: string | undefined,
  slots: TacticSlot[],
): {
  text: Map<string, string>;
  ranges: Map<string, ProofStepPosition[]>;
  flags: Map<string, ParsedFlags>;

  flagRanges: Map<string, ProofStepPosition[]>;
} {
  const out = new Map<string, string>();
  const ranges = new Map<string, ProofStepPosition[]>();
  const flags = new Map<string, ParsedFlags>();
  const flagRanges = new Map<string, ProofStepPosition[]>();
  if (comments.length === 0 || steps.length === 0)
    return { text: out, ranges, flags, flagRanges };
  const byStart = [...steps].sort((a, b) =>
    cmpPos(a.position.start, b.position.start),
  );

  const surfaceStart = (s: ProofStep) => {
    let best: TacticSlot | undefined;
    for (const sl of slots)
      if (
        cmpPos(sl.start, s.position.start) <= 0 &&
        cmpPos(s.position.start, sl.stop) < 0 &&
        (!best || cmpPos(sl.start, best.start) > 0)
      )
        best = sl;
    return best?.start ?? s.position.start;
  };
  const first = byStart[0];
  let cur: SourceComment;
  const add = (nodeId: string, raw: string) => {
    const parsed = parseFlags(raw);
    const f: ParsedFlags = { ...parsed, prose: cleanMarkdown(parsed.prose) };
    if (f.any) {
      const prev = flags.get(nodeId);

      flags.set(nodeId, {
        ...prev,
        ...f,
        onlyHyps: [...(prev?.onlyHyps ?? []), ...(f.onlyHyps ?? [])],
        prose: f.prose || prev?.prose || "",
        any: true,
      });
      flagRanges.set(nodeId, [
        ...(flagRanges.get(nodeId) ?? []),
        { start: cur.start, stop: cur.stop },
      ]);
    }

    const text = f.elide ? "" : f.prose;

    if (text === "") return;
    out.set(nodeId, out.has(nodeId) ? `${out.get(nodeId)}\n${text}` : text);
    ranges.set(nodeId, [
      ...(ranges.get(nodeId) ?? []),
      { start: cur.start, stop: cur.stop },
    ]);
  };
  const sorted = [...comments].sort((a, b) => cmpPos(a.start, b.start));
  for (const c of sorted) {
    cur = c;
    const text = stripCommentText(c.text);
    if (text === "") continue;
    const container = byStart
      .filter(
        (s) =>
          cmpPos(s.position.start, c.start) < 0 &&
          cmpPos(c.start, s.position.stop) < 0,
      )
      .pop();
    if (container) {
      const inner =
        c.start.line === container.position.start.line
          ? undefined
          : byStart.find(
              (s) =>
                cmpPos(s.position.start, c.stop) >= 0 &&
                cmpPos(surfaceStart(s), container.position.stop) <= 0,
            );
      add(tacticId((inner ?? container).goalBefore.id), text);
      continue;
    }

    if (rootId && isDocComment(c) && cmpPos(c.stop, first.position.start) <= 0) {
      add(rootId, text);
      continue;
    }
    const next = byStart.find((s) => cmpPos(s.position.start, c.stop) >= 0);
    if (next) {
      add(tacticId(next.goalBefore.id), text);
      continue;
    }
    const prev = [...byStart]
      .reverse()
      .find((s) => cmpPos(s.position.start, c.start) <= 0);
    if (prev) add(tacticId(prev.goalBefore.id), text);
  }
  return { text: out, ranges, flags, flagRanges };
}

function cleanLabel(label: string, comments: SourceComment[]): string {
  let t = label;
  let scrubbed = false;
  for (const c of comments)
    if (t.includes(c.text)) {
      t = t.split(c.text).join("");
      scrubbed = true;
    }
  const lines = t.split("\n").map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === "")
    lines.pop();

  const kept = scrubbed ? lines.filter((l, i) => i === 0 || l !== "") : lines;
  return kept.join("\n");
}

export interface ProofToTreeOptions {
  hypMode?: HypMode;

  hypGroup?: boolean;

  brief?: boolean;

  slots?: TacticSlot[];

  ledger?: boolean;

  openLinks?: ReadonlySet<string>;
}

export function proofToTree(
  proof: Proof,
  {
    hypMode = "used",
    hypGroup = false,
    brief = false,
    slots,
    ledger = true,
    openLinks,
  }: ProofToTreeOptions = {},
): TreeNode[] {
  const goals = goalIndex(proof);

  const recoveredAt = new Map<
    string,
    "failed" | "skipped" | "term" | "subterm"
  >();
  for (const r of proof.recovered ?? [])
    recoveredAt.set(`${r.start.line}:${r.start.character}`, r.kind);

  // B3 — LEMMA REFERENCES. The `lemmaRefs` sidecar is keyed by the innermost
  // containing step's `position.start`, the same key `recoveredAt` uses; one
  // pass turns it into a per-position list in wire order (source order of
  // first occurrence, already deduped by name server-side).
  const lemmasAt = new Map<string, { name: string; doc?: string; kind?: string }[]>();
  for (const r of proof.lemmaRefs ?? []) {
    const k = `${r.stepStart.line}:${r.stepStart.character}`;
    const cur = lemmasAt.get(k);
    const one = { name: r.name, doc: r.doc, kind: r.kind };
    if (cur) cur.push(one);
    else lemmasAt.set(k, [one]);
  }

  // B5 — CASE/BRANCH SEMANTICS. `branches` is the syntax kind's own answer to
  // what a branching tactic did, keyed on `position.start` like every other
  // sidecar. It replaces the label-family regexes that used to decide which of
  // several goals-after continues the proof (`MAIN_FIRST_RE`) and whether a
  // producer takes `| case =>` alternatives (`label.endsWith("with")`), and it
  // is what lets a case badge read `succ k ih` / `inl ⟨k, hk⟩` where before it
  // could only read the goal's own username.
  //
  // An `arms` array that is EMPTY means the server recognised the FORM and
  // could not decode its arms (`match`, `split`, a nested `rcases`
  // alternation): everything below then falls back to what it did before,
  // which is why the fallbacks are still here.
  const branchAt = new Map<string, BranchInfo>();
  for (const b of proof.branches ?? [])
    branchAt.set(`${b.stepStart.line}:${b.stepStart.character}`, b);
  const branchOf = (s: ProofStep): BranchInfo | undefined =>
    branchAt.get(`${s.position.start.line}:${s.position.start.character}`);
  const armByGoal = new Map<string, BranchArm>();
  for (const b of proof.branches ?? [])
    for (const a of b.arms) if (a.goalId) armByGoal.set(a.goalId, a);

  const stepByGoal = new Map<string, ProofStep>();
  for (const step of proof.steps) stepByGoal.set(step.goalBefore.id, step);

  // B2 — HYPOTHESIS PROVENANCE. The `hypOrigins` sidecar names the SOURCE
  // POSITION of the step that first bound each fvarId; the tactic node drawn
  // for a step is `tacticId(step.goalBefore.id)`, so one position→step map
  // turns the sidecar into node ids.
  //
  // Matching is BY ID ALONE — no username fallback, unlike the used-set's
  // `deepUsed`. There the fallback is needed because a subtree's ids drift
  // from the goal's (`rw … at h` re-mints `h`); here the drift is the POINT:
  // the re-minting step registers the new id, so the table's key is always the
  // id as the goal in hand carries it, and an id-miss means the hypothesis was
  // never introduced by any step. A name fallback was written, measured on the
  // corpus, and REMOVED: it fired twice in 1300 context lines and was wrong
  // both times, pointing `commented.lean`'s statement binder `h` at the
  // `rw [hb] at h` that would later rewrite it. A hyp with no answer is one of
  // the declaration's own binders — "from the statement", said by silence.
  const stepAtPos = new Map<string, ProofStep>();
  for (const s of proof.steps) {
    const k = `${s.position.start.line}:${s.position.start.character}`;
    if (!stepAtPos.has(k)) stepAtPos.set(k, s);
  }
  const originById = new Map<string, HypOriginRef>();
  for (const o of proof.hypOrigins ?? []) {
    const s = stepAtPos.get(`${o.start.line}:${o.start.character}`);
    if (!s) continue;
    originById.set(o.id, {
      origin: tacticId(s.goalBefore.id),
      originText: tacticHead(s.tacticString),
      originLine: o.start.line + 1,
    });
  }
  const originOf = (h: Hypothesis): HypOriginRef | undefined =>
    originById.get(h.id);

  // D1 — USE COUNTS. `haveUses` is keyed on the introducing step's position
  // like every other sidecar, and its `users` are positions; the node id of a
  // step is `tacticId(step.goalBefore.id)`, so `stepAtPos` turns both ends
  // into node ids. A user position that names no step (nothing is drawn for
  // it) is dropped from `users` but still counted — `count` is the
  // ELABORATOR's number and must not shrink because the view hid a step.
  //
  // TWO stampings, because a step can bind more than one name: `obtain
  // ⟨k, hk⟩` and `intro m n` each ship one `haveUses` entry PER NAME at the
  // same position. `uses` is the LAST of them and is what D1's inline reads
  // (it declines anything but a `have`, which binds one); `usesEach` is all of
  // them in source order, which is what the D5 rename asks — it starts from a
  // hypothesis LINE and needs that line's own name, not its step's.
  const usesAt = new Map<string, { name: string; count: number; users: string[] }>();
  const usesEachAt = new Map<
    string,
    { name: string; count: number; users: string[] }[]
  >();
  for (const u of proof.haveUses ?? []) {
    const users: string[] = [];
    for (const p of u.users) {
      const s = stepAtPos.get(`${p.line}:${p.character}`);
      if (s) users.push(tacticId(s.goalBefore.id));
    }
    const one = { name: u.name, count: u.users.length, users };
    const k = `${u.stepStart.line}:${u.stepStart.character}`;
    usesAt.set(k, one);
    const all = usesEachAt.get(k);
    if (all) all.push(one);
    else usesEachAt.set(k, [one]);
  }

  function subtreeLastStep(goalId: string): ProofStep | undefined {
    const s = stepByGoal.get(goalId);
    if (!s) return undefined;
    let best = s;
    for (const g of stepGoalsAfter(s)) {
      const b = subtreeLastStep(g.id);
      if (b && cmpPos(b.position.stop, best.position.stop) > 0) best = b;
    }
    return best;
  }

  const subtreeUsedMemo = new Map<string, Map<string, string>>();
  function subtreeUsed(goalId: string): Map<string, string> {
    const memo = subtreeUsedMemo.get(goalId);
    if (memo) return memo;
    const out = new Map<string, string>();
    const s = stepByGoal.get(goalId);
    if (s) {
      const nameById = new Map(s.goalBefore.hyps.map((h) => [h.id, h.username]));
      for (const id of s.tacticDependsOn) out.set(id, nameById.get(id) ?? "");
      for (const g of stepGoalsAfter(s))
        for (const [id, name] of subtreeUsed(g.id))
          if (!out.has(id)) out.set(id, name);
    }
    subtreeUsedMemo.set(goalId, out);
    return out;
  }

  const holeByGoal = new Map<string, Hole>(
    (proof.holes ?? []).filter((h) => !h.dup).map((h) => [h.goalId, h]),
  );

  const fillableHole = (goalId: string): Hole | undefined => {
    const h = holeByGoal.get(goalId);
    return h && !h.inBlock ? h : undefined;
  };

  const chainByTactic = new Map<string, CalcChain>(
    (proof.calcChains ?? []).map((c) => [
      `${c.tacticStart.line}:${c.tacticStart.character}`,
      c,
    ]),
  );
  const isChain = (step: ProofStep) => /^calc\b/.test(step.tacticString);

  const isStub = (step: ProofStep) => step.tacticString.trim() === "sorry";

  function firstStubLine(prod: ProofStep): number | undefined {
    let min: number | undefined;
    for (const g of stepGoalsAfter(prod)) {
      const s = stepByGoal.get(g.id);
      if (!s) continue;
      const l = s.position.start.line;
      if (min === undefined || l < min) min = l;
    }
    return min;
  }

  const termLedgerByTactic = new Map<string, TermLedger>(
    (proof.termLedgers ?? []).map((l) => [
      `${l.tacticStart.line}:${l.tacticStart.character}`,
      l,
    ]),
  );

  /** B1/Part E — a STRUCTURED TERM's ledger, the calc idiom applied to an
   `exact ⟨…⟩`. Same shape, same node, same gestures; the only difference is
   where the rows come from. A calc chain threads them out of the relation
   (`spineRelation` down the links, with the head `lhs` as row 0); a
   constructor has no relation to thread, so the SERVER names the components
   — that is all `termLedgers` carries — and the row's text is still read off
   the goal here, exactly as a link's is.

   The gates are the calc ones, asked of the same things: a row needs a
   justification step that is neither a `sorry` stub nor a hole, and below two
   rows the component is better served by the branch box it already had. */
  function ctorLedgerFor(
    step: ProofStep,
  ): { rows: LedgerRow[]; settled: Set<string>; kind: "ctor" } | null {
    const spec = termLedgerByTactic.get(
      `${step.position.start.line}:${step.position.start.character}`,
    );
    if (!spec) return null;
    const available = new Map(stepGoalsAfter(step).map((g) => [g.id, g]));
    const rows: LedgerRow[] = [];
    const settled = new Set<string>();
    for (const r of spec.rows) {
      const g = available.get(r.goalId);
      if (!g || settled.has(g.id)) continue;
      const just = stepByGoal.get(g.id);
      if (!just || isStub(just) || holeByGoal.has(g.id)) continue;
      rows.push({
        goalId: g.id,
        text: goals.get(g.id)?.type ?? "",
        position: just.position,
      });
      settled.add(g.id);
    }
    if (rows.length < 2) return null;
    return { rows, settled, kind: "ctor" };
  }

  function ledgerFor(
    step: ProofStep,
  ): { rows: LedgerRow[]; settled: Set<string>; kind: "calc" } | null {
    const links: {
      goalId: string;
      lhs: string;
      rhs: string;
      hidden: string;
      text: string;
      at: ProofStepPosition;
    }[] = [];
    for (const g of stepGoalsAfter(step)) {
      const just = stepByGoal.get(g.id);
      if (!just || isStub(just) || holeByGoal.has(g.id)) continue;
      const type = goals.get(g.id)?.type ?? "";
      const r = spineRelation(type);
      if (!r) continue;

      const tail = type.slice(r.lhs.length);
      const ws = tail.length - tail.trimStart().length;
      links.push({
        goalId: g.id,
        lhs: r.lhs,
        rhs: r.rhs,
        hidden: type.slice(0, r.lhs.length + ws),
        text: type.slice(r.lhs.length + ws),
        at: just.position,
      });
    }
    links.sort((a, b) => cmpPos(a.at.start, b.at.start));

    const rows: typeof links = [];
    for (const l of links) {
      if (rows.length > 0 && l.lhs !== rows[rows.length - 1].rhs) break;
      rows.push(l);
    }

    if (rows.length < 2) return null;
    return {
      rows: [
        { text: rows[0].lhs },
        ...rows.map((l) => ({
          goalId: l.goalId,
          text: l.text,
          hiddenLhs: l.hidden,
          position: l.at,
        })),
      ],
      settled: new Set(rows.map((l) => l.goalId)),
      kind: "calc",
    };
  }

  // Which of a multi-goal step's children is the proof's CONTINUATION and
  // which are obligations the tactic made on the way. The rewrite family is
  // the one form where the first goal-after is the continuation; before B5
  // that was a regex over the label, and it is now the sidecar's `form`
  // (which the server read off `rwSeq`/`rewriteSeq`/`erw`'s syntax kind, and
  // which rides EVERY step the `rw`'s syntax covers, since `rw [a, b]` is
  // harvested one step per rule). The regex survives ONLY where no branch
  // reached the step at all.
  const MAIN_FIRST_RE = /^(rw|rewrite|erw)\b/;
  const shapeSource = (step: ProofStep): "branch" | "regex" | "none" => {
    if (step.goalsAfter.length < 2 && stepGoalsAfter(step).length < 2)
      return "none";
    if (branchOf(step)) return "branch";
    return MAIN_FIRST_RE.test(step.tacticString) ? "regex" : "none";
  };
  const mainFirst = (step: ProofStep) => {
    if (step.goalsAfter.length < 2) return false;
    const b = branchOf(step);
    if (b) return b.form === "rewrite";
    return MAIN_FIRST_RE.test(step.tacticString);
  };

  const relsByGoal = new Map<string, CalcRelations>(
    (proof.calcRelations ?? []).map((r) => [r.goalId, r]),
  );

  function relOptions(
    goalId: string,
    fallbackRel: string | undefined,
    want?: string,
  ): CalcRelOption[] | undefined {
    const entry = relsByGoal.get(goalId);
    if (!entry)
      return fallbackRel
        ? [{ rel: fallbackRel, next: fallbackRel, same: true }]
        : undefined;
    const opts = want
      ? entry.options.filter((o) => o.next === want)
      : entry.options;
    return opts.length ? opts : undefined;
  }

  const brokenChainByGoal = new Map<
    string,
    { chain: CalcChain; step?: ProofStep }
  >();
  {
    const broken = (proof.calcChains ?? [])
      .filter((c) => c.broken)
      .sort((a, b) => cmpPos(a.tacticStart, b.tacticStart));
    if (broken.length) {
      const producer = new Map<string, ProofStep>();
      for (const s of proof.steps)
        for (const g of s.goalsAfter) producer.set(g.id, s);
      const pendingIds = [...producer.keys()].filter((id) => !stepByGoal.has(id));
      for (const c of broken) {
        let target: string | undefined;

        let inner: ProofStep | undefined;
        for (const s of proof.steps) {
          if (!positionContains(s.position, c.tacticStart)) continue;
          if (!inner || cmpPos(s.position.start, inner.position.start) > 0) inner = s;
        }
        target = inner?.goalBefore.id;

        if (!target) {
          let bestPos: LspPos | undefined;
          for (const id of pendingIds) {
            if (brokenChainByGoal.has(id)) continue;
            const p = producer.get(id)!.position.start;
            if (cmpPos(p, c.tacticStart) >= 0) continue;
            if (!bestPos || cmpPos(p, bestPos) > 0) {
              target = id;
              bestPos = p;
            }
          }
        }
        if (target && !brokenChainByGoal.has(target))
          brokenChainByGoal.set(target, { chain: c, step: inner });
      }
    }
  }

  function repairSpec(
    goalId: string,
    chain: CalcChain,
    prod: ProofStep | undefined,
  ): AddSpec | undefined {
    const first = chain.links < 1;
    if (first && !chain.firstBare) return undefined;

    const rels = relOptions(goalId, spineRelation(goals.get(goalId)?.type ?? "")?.rel);
    const rel = rels?.[0].rel;
    if (!rel) return undefined;

    const at = prod?.position ?? { start: chain.tacticStart, stop: chain.tacticStart };
    return {
      kind: first ? "calc-first" : "calc-append",
      chain,
      rel,
      rels,
      indent: chain.indent,
      producer: at,
      after: at,
    };
  }

  function calcRelations(
    goalId: string,
    type: string,
  ): CalcRelOption[] | undefined {
    return relOptions(goalId, spineRelation(type)?.rel);
  }

  function addLinkFor(
    goalId: string,
    prod: ProofStep,

    stub?: ProofStep,
  ): AddSpec | undefined {
    if (stub) {
      const chain = chainByTactic.get(
        `${prod.position.start.line}:${prod.position.start.character}`,
      );

      const first = firstStubLine(prod);
      if (!chain || first === undefined || stub.position.start.line <= first)
        return undefined;
      const own = spineRelation(goals.get(goalId)?.type ?? "")?.rel;
      const rels = relOptions(goalId, own, relsByGoal.get(goalId)?.rel ?? own);
      return {
        kind: "calc-link",
        hole: {
          goalId,
          start: stub.position.start,
          stop: stub.position.stop,
          ownerStart: {
            line: stub.position.start.line,
            character: chain.indent,
          },
          first: false,
          inCalc: true,
          inBlock: false,
        },
        rel: rels?.[0].rel ?? own,
        rels,
        indent: chain.indent,
        producer: prod.position,
        after: prod.position,
      };
    }
    const hole = holeByGoal.get(goalId);

    if (hole?.inCalc) {
      if (hole.first) return undefined;

      const own = spineRelation(goals.get(goalId)?.type ?? "")?.rel;
      const rels = relOptions(goalId, own, relsByGoal.get(goalId)?.rel ?? own);
      return {
        kind: "calc-link",
        hole,
        rel: rels?.[0].rel ?? own,
        rels,
        indent: hole.ownerStart.character,
        producer: prod.position,
        after: prod.position,
      };
    }

    if (!isChain(prod)) return undefined;
    const chain = chainByTactic.get(
      `${prod.position.start.line}:${prod.position.start.character}`,
    );
    const rels = relOptions(goalId, spineRelation(goals.get(goalId)?.type ?? "")?.rel);
    const rel = rels?.[0].rel;
    if (!chain || !rel) return undefined;
    return {
      kind: "calc-append",
      chain,
      rel,
      rels,
      indent: chain.indent,
      producer: prod.position,
      after: prod.position,
    };
  }

  function ownedGoals(step: ProofStep): string[] {
    if (step.spawnedGoals.length > 0) return step.spawnedGoals.map((g) => g.id);
    return step.goalsAfter.length > 1 ? step.goalsAfter.map((g) => g.id) : [];
  }

  function deleteSpecFor(
    kind: "tactic" | "goal",
    step: ProofStep | undefined,
    comments: ProofStepPosition[] | undefined,
  ): DeleteSpec | undefined {
    if (!step) return undefined;

    if (
      ["term", "subterm"].includes(
        recoveredAt.get(
          `${step.position.start.line}:${step.position.start.character}`,
        ) ?? "",
      )
    )
      return undefined;
    const anchors = [step.position];

    const owned =
      kind === "goal"
        ? stepGoalsAfter(step).map((g) => g.id)
        : ownedGoals(step);
    for (const g of owned) {
      const last = subtreeLastStep(g);
      if (last) anchors.push(last.position);
    }
    return { kind, anchors, comments: comments ?? [] };
  }

  function openBlockSpec(ob: OpenBlock): AddSpec {
    const at = { start: ob.anchor, stop: ob.anchor };
    return { kind: "seq", indent: ob.indent, producer: at, after: at };
  }

  function addSpecFor(goalId: string, prod: ProofStep): AddSpec {
    const hole = fillableHole(goalId);
    if (hole)
      return {
        kind: "hole",
        hole,
        indent: hole.ownerStart.character,
        producer: prod.position,
        after: prod.position,
      };
    const label = prod.tacticString.trimEnd();
    const base = prod.position.start.character;
    let anchor = prod;
    for (const g of stepGoalsAfter(prod)) {
      const b = subtreeLastStep(g.id);
      if (b && cmpPos(b.position.stop, anchor.position.stop) > 0) anchor = b;
    }

    // Does this producer take `| case =>` alternatives? The sidecar knows,
    // because the `inductionAlts` block is part of the tactic's own syntax;
    // the trailing-`with` text test is what answers where it does not reach.
    const prodBranch = branchOf(prod);
    const takesAlts = prodBranch
      ? prodBranch.withAlts === true
      : label.endsWith("with");
    if (takesAlts)
      return {
        kind: "case",
        indent: base,
        producer: prod.position,
        after: anchor.position,
        caseName: caseName(goals.get(goalId)),
      };

    if (prod.goalsAfter.length <= 1)
      return {
        kind: "seq",
        indent: base,
        producer: prod.position,
        after: anchor.position,
      };
    return {
      kind: "bullet",
      indent: base,
      producer: prod.position,
      after: anchor.position,
    };
  }

  const roots = rootIds(proof);

  const commentByNode = attributeComments(
    proof.comments ?? [],
    proof.steps,
    roots[0],
    slots ?? proof.deleteSlots ?? [],
  );

  const hypFlags = new Map<string, ParsedFlags>();
  for (const [nodeId, f] of commentByNode.flags)
    hypFlags.set(
      nodeId.startsWith(TACTIC_PREFIX) ? nodeId.slice(TACTIC_PREFIX.length) : nodeId,
      f,
    );

  const nodes: TreeNode[] = [];
  const emittedGoals = new Set<string>();

  function visitGoal(
    goalId: string,
    parents: TreeNode["parents"],
    producedBy?: ProofStep,

    parentCase?: string,

    lhsElide?: string,

    side?: boolean,

    spawned?: boolean,

    ledgerParent?: string,

    chainCtx?: ReadonlySet<string>,
  ): void {
    if (emittedGoals.has(goalId)) return;
    emittedGoals.add(goalId);

    const goal = goals.get(goalId);
    const step = stepByGoal.get(goalId);
    const thisCase = caseName(goal);
    const arm = armByGoal.get(goalId);

    const openRoot = !step && !producedBy && goalId === proof.openBlock?.goal.id;
    const pending =
      openRoot ||
      (!step && !!producedBy && producedBy.goalsAfter.some((g) => g.id === goalId));

    const brokenChain = brokenChainByGoal.get(goalId);

    const stub =
      !brokenChain && !pending && step && producedBy && isChain(producedBy) && isStub(step)
        ? step
        : undefined;
    const addLink =

      brokenChain || !producedBy || (!pending && !stub)
        ? undefined
        : addLinkFor(goalId, producedBy, stub);
    const goalText = goal?.type ?? goalId;
    const elided =
      lhsElide && goalText.startsWith(lhsElide)
        ? "_" + goalText.slice(lhsElide.length)
        : undefined;

    const goalHyps =
      goal &&
      contextFor(
        goal,
        step,
        producedBy,
        hypMode,
        hypFlags.get(goalId),
        hypMode === "used" ? subtreeUsed(goalId) : undefined,
        hypGroup,
        chainCtx,
        originOf,
      );

    const rflResidue = (() => {
      if (!chainCtx || !goal || !step) return undefined;
      if (!/^rw \[rfl\](\s|$)/.test(step.tacticString)) return undefined;
      const r = spineRelation(goal.type);
      return r && r.rel === "=" && r.lhs === r.rhs ? true : undefined;
    })();

    if (rflResidue && step && stepGoalsAfter(step).length === 0) return;

    if (!ledgerParent)
      nodes.push({
      id: goalId,

      label: TURNSTILE + (elided ?? goalText),
      goalElision: elided ? { hidden: lhsElide! } : undefined,
      type: "goal",
      parents,

      side: side || undefined,

      spawned: spawned || undefined,

      position: producedBy?.position,

      hyps: goalHyps,

      rflResidue,
      comment: commentByNode.text.get(goalId),
      commentRanges: commentByNode.ranges.get(goalId),

      flags: nodeFlags(
        commentByNode.flags.get(goalId),
        step ? [tacticId(goalId)] : [],
      ),
      flagRanges: commentByNode.flagRanges.get(goalId),

      hypFlagged:
        !!hypFlags.get(goalId)?.noHyps ||
        (hypFlags.get(goalId)?.onlyHyps?.length ?? 0) > 0 ||
        undefined,

      // The case badge. Its BASE is what it always was — the goal's own tag,
      // minus the parent's prefix — and B5's arm is what it now says beside
      // it: the names the arm binds (`succ k ih`) or the pattern the author
      // wrote (`inl ⟨k, hk⟩`). Only a badge that would be drawn ANYWAY grows;
      // an arm under a goal that shares its parent's tag adds no badge, so no
      // node gains height it did not have.
      caseLabel: armLabel(
        thisCase === parentCase
          ? undefined
          : parentCase && thisCase?.startsWith(parentCase + ".")
            ? thisCase.slice(parentCase.length + 1)
            : thisCase,
        arm,
      ),

      arm,

      addSpec:
        pending && !brokenChainByGoal.has(goalId)
          ? producedBy
            ? addSpecFor(goalId, producedBy)
            : openBlockSpec(proof.openBlock!)
          : undefined,

      addLink,

      calcRels:
        pending &&
        goal &&
        !fillableHole(goalId) &&
        !addLink &&
        !brokenChain
          ? calcRelations(goalId, goal.type)
          : undefined,

      deleteSpec: deleteSpecFor(
        "goal",
        step,
        roots.includes(goalId) ? [] : commentByNode.ranges.get(goalId),
      ),
      });

    if (brokenChain && !brokenChain.step) {
      const c = brokenChain.chain;
      nodes.push({
        id: `calc:${c.tacticStart.line}:${c.tacticStart.character}`,
        label: c.text,
        type: "tactic",
        parents: [{ id: ledgerParent ?? goalId }],

        position: { start: c.tacticStart, stop: c.stop },
        chain: true,
        synthetic: true,
        addLink: repairSpec(goalId, c, producedBy),
      });
    }

    if (!step) return;

    const tId = tacticId(goalId);
    const fullLabel = cleanLabel(step.tacticString, proof.comments ?? []);

    const collapsed = brief
      ? collapseLabel(fullLabel, branchOf(step)?.form)
      : null;
    const chain = isChain(step);

    // ONE ledger, two sources of rows. A calc chain reads its own links; a
    // structured term (`exact ⟨a, b, c⟩`) reads the server's row list.
    // Everything below this line — the node, the row gestures, the layout, the
    // paint — cannot tell them apart, and nothing here is calc-only except the
    // label: `calc` stands for its chain, while a constructor's tactic keeps
    // its own text (and its brief-mode elision) with the parts listed under it.
    const led = !ledger || brokenChain
      ? null
      : chain
        ? ledgerFor(step)
        : ctorLedgerFor(step);
    const calcLed = led?.kind === "calc";
    const drawnLabel = calcLed
      ? "calc"
      : collapsed
        ? collapsed.text
        : fullLabel;
    nodes.push({
      id: tId,
      label: drawnLabel,

      elision:
        collapsed && !calcLed
          ? {
              original: collapsed.original,
              keep: collapsed.keep,
              marks: collapsed.marks,
            }
          : undefined,
      type: "tactic",
      parents: [{ id: ledgerParent ?? goalId }],

      chain,

      ledgerKind: led?.kind,

      position: step.position,
      recovered: recoveredAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ),
      lemmas: lemmasAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ),
      uses: usesAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ),
      usesEach: usesEachAt.get(
        `${step.position.start.line}:${step.position.start.character}`,
      ),
      branch: branchOf(step),
      shapeSource: shapeSource(step),
      comment: commentByNode.text.get(tId),
      commentRanges: commentByNode.ranges.get(tId),

      flags: nodeFlags(
        commentByNode.flags.get(tId),
        (step.spawnedGoals.length > 0 ? step.spawnedGoals : step.goalsAfter).map(
          (g) => g.id,
        ),
        true,
      ),
      flagRanges: commentByNode.flagRanges.get(tId),

      addLink:
        brokenChain?.step === step
          ? repairSpec(goalId, brokenChain.chain, producedBy)
          : undefined,

      deleteSpec: deleteSpecFor("tactic", step, commentByNode.ranges.get(tId)),
    });

    const chainCtxNext = chain
      ? calcLed && goalHyps
        ? new Set(goalHyps.map((h) => h.text))
        : EMPTY_CTX
      : chainCtx;
    if (led) {
      const at = step.position.start;
      nodes.push({
        id: `ledger:${at.line}:${at.character}`,

        label: led.rows.map((r) => r.text).join("\n"),
        type: "goal",
        parents: [{ id: tId }],

        position: step.position,
        ledger: led.rows,
        ledgerKind: led.kind,

        hyps: goalHyps,
        hypGoalId: goalId,
        hypsInheritedFrom:
          hypMode !== "full" && goalHyps?.length ? goalId : undefined,

        chain: calcLed || undefined,
      });
    }

    const children = stepGoalsAfter(step);

    const linkElisions = brief && chain
      ? chainLhsElisions(children, step.goalBefore.type)
      : undefined;

    const mainGoalId = mainFirst(step) ? step.goalsAfter[0].id : undefined;
    const spawnedIds = new Set(step.spawnedGoals.map((g) => g.id));

    // Children in SOURCE ORDER of the branch's arms, where the sidecar
    // resolved every one of them to a child of this very step; anything short
    // of that (a `match`, a nested `rcases`, a spawned goal no arm claims)
    // keeps the harvest's own order, which is what was drawn before B5.
    const armOrder = (() => {
      const b = branchOf(step);
      if (!b || b.arms.length === 0 || b.arms.length !== children.length)
        return undefined;
      const byId = new Map(children.map((c) => [c.id, c]));
      const out: typeof children = [];
      for (const a of b.arms) {
        const c = a.goalId ? byId.get(a.goalId) : undefined;
        if (!c) return undefined;
        out.push(c);
      }
      return out;
    })();

    const order = led
      ? [
          ...led.rows.flatMap((r) =>
            children.filter((c) => c.id === r.goalId),
          ),
          ...children.filter((c) => !led.settled.has(c.id)),
        ]
      : (armOrder ?? children);
    const ledgerId = `ledger:${step.position.start.line}:${step.position.start.character}`;

    let settledIdx = 0;
    for (const child of order) {
      const ledgered = led?.settled.has(child.id) ?? false;
      const open =
        ledgered && (openLinks?.has(`${ledgerId}#${settledIdx}`) ?? false);
      if (ledgered) settledIdx++;
      visitGoal(
        child.id,

        [{ id: ledgered ? ledgerId : tId }],
        step,
        thisCase,
        linkElisions?.get(child.id),
        mainGoalId !== undefined && child.id !== mainGoalId,
        spawnedIds.has(child.id),
        ledgered && !open ? ledgerId : undefined,
        chainCtxNext,
      );
    }
  }

  for (const rootId of roots) visitGoal(rootId, []);
  return nodes;
}
