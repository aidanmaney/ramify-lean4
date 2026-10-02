// The RENDER MATRIX's scenes — pure data, no React, no DOM, so `probe matrix`
// can build every one of them under node and check that each cell's target
// exists.  A scene is a tiny `Proof` (hand-built here, or cut out of the
// corpus) and the ids of the nodes the matrix puts its states on.  Nothing in
// here touches a product module's behaviour: it only builds the same `Proof`
// the widget and the NDJSON harness hand the view.
import type {
  GoalInfo,
  Hypothesis,
  Proof,
  ProofStep,
  SourceComment,
  TacticSlot,
} from "./paperproof";
import { tacticId } from "./proofToTree";

type Pos = { line: number; character: number };

/** Extra comment lines to put ABOVE step `step` (an index into the scene's
 steps, source order): prose, or a flag such as `.mark` / `.fold` / `.none …`.
 Each string is one `-- …` line, so a flag and its prose are separate lines
 exactly as an author writes them. */
export type Above = Record<number, string[]>;

export interface Built {
  proof: Proof;
  /** Node ids by role — the matrix finds the node a state goes on by these. */
  ids: Record<string, string>;
  /** Source position of each step's tactic, in source order. */
  starts: Pos[];
  /** Where an extra source line just past the last step would be (cf stub). */
  endLine: number;
}

class SceneBuilder {
  private line = 6;
  private nextHyp = 0;
  readonly steps: (ProofStep & { _indent: number; _above: string[]; _block: number })[] = [];
  readonly allGoals: GoalInfo[] = [];
  private blockCounts = new Map<number, number>();
  private blockSeq = 0;
  private above: Above;
  constructor(above: Above) {
    this.above = above;
  }

  hyp(username: string, type: string, isProof = false): Hypothesis {
    return { id: `_uniq.h${this.nextHyp++}`, username, type, value: null, isProof: isProof ? "proof" : "data" };
  }
  goal(id: string, hyps: Hypothesis[], type: string, username = "[anonymous]"): GoalInfo {
    const g = { id, hyps, type, username };
    this.allGoals.push(g);
    return g;
  }
  /** One tactic step.  `deps` are the hyps the tactic reads (what the `used`
   context shows); `block` groups steps of one tactic block for the delete
   slots. */
  step(
    before: GoalInfo,
    tactic: string,
    after: GoalInfo[],
    o: { indent?: number; spawned?: GoalInfo[]; deps?: Hypothesis[]; block?: number } = {},
  ): number {
    const indent = o.indent ?? 2;
    const idx = this.steps.length;
    const block = o.block ?? 0;
    this.blockCounts.set(block, (this.blockCounts.get(block) ?? 0) + 1);
    this.steps.push({
      tacticString: tactic,
      goalBefore: before,
      goalsAfter: after,
      spawnedGoals: o.spawned ?? [],
      tacticDependsOn: (o.deps ?? []).map((h) => h.id),
      position: { start: { line: 0, character: indent }, stop: { line: 0, character: 0 } },
      theorems: [],
      _indent: indent,
      _above: this.above[idx] ?? [],
      _block: block,
    });
    return idx;
  }
  newBlock(): number {
    return ++this.blockSeq;
  }

  finish(extra: Partial<Proof> = {}): { proof: Proof; starts: Pos[]; endLine: number } {
    const comments: SourceComment[] = [];
    const slots: TacticSlot[] = [];
    const seenInBlock = new Map<number, number>();
    const blockStart = new Map<number, Pos>();
    let line = this.line;
    const lines: { start: Pos; tightStop: Pos }[] = [];
    for (const s of this.steps) {
      for (const text of s._above) {
        const t = `-- ${text}`;
        comments.push({
          text: t,
          start: { line, character: s._indent },
          stop: { line, character: s._indent + t.length },
        });
        line++;
      }
      const start = { line, character: s._indent };
      s.position.start = start;
      lines.push({ start, tightStop: { line, character: s._indent + s.tacticString.length } });
      line++;
    }
    this.steps.forEach((s, i) => {
      s.position.stop = i + 1 < this.steps.length ? lines[i + 1].start : { line, character: 0 };
      const bs = blockStart.get(s._block) ?? lines[i].start;
      blockStart.set(s._block, bs);
      const index = seenInBlock.get(s._block) ?? 0;
      seenInBlock.set(s._block, index + 1);
      slots.push({
        start: lines[i].start,
        stop: lines[i].tightStop,
        blockStart: bs,
        index,
        count: this.blockCounts.get(s._block) ?? 1,
        lineStart: true,
        tailIsTrivia: true,
        tailStop: lines[i].tightStop,
        prevSameLine: false,
      });
    });
    const proof: Proof = {
      steps: this.steps.map(({ _indent, _above, _block, ...s }) => {
        void _indent; void _above; void _block;
        return s;
      }),
      allGoals: this.allGoals,
      comments,
      holes: [],
      calcChains: [],
      calcRelations: [],
      deleteSlots: slots,
      declRange: { start: { line: 4, character: 0 }, stop: { line, character: 0 } },
      ...extra,
    };
    return { proof, starts: lines.map((l) => l.start), endLine: line };
  }
}

export interface Scene {
  id: string;
  /** The tactic steps in source order, said in words, for the probe. */
  about: string;
  build: (above?: Above) => Built;
}


/** root goal, a goal with four hypotheses, and a tactic. */
const basic: Scene = {
  id: "basic",
  about: "G0 (3 hyps) → intro hle → G1 (4 hyps) → omega",
  build(above = {}) {
    const b = new SceneBuilder(above);
    const n = b.hyp("n", "ℕ");
    const hn = b.hyp("hn", "0 < n", true);
    const hev = b.hyp("hev", "Even n", true);
    const hle = b.hyp("hle", "n ≤ 10", true);
    const g0 = b.goal("g0", [n, hn, hev], "n ≤ 10 → n + 0 = n");
    const g1 = b.goal("g1", [n, hn, hev, hle], "n + 0 = n");
    b.step(g0, "intro hle", [g1]);
    b.step(g1, "omega", [], { deps: [n, hn, hev, hle] });
    const f = b.finish();
    return { ...f, ids: { root: "g0", goal: "g1", tactic: tacticId("g0"), closer: tacticId("g1") } };
  },
};

/** a three-rewrite chain: fold the middle goal, or hop the middle step. */
const chain: Scene = {
  id: "chain",
  about: "G0 → rw → G1 → rw → G2 → rfl",
  build(above = {}) {
    const b = new SceneBuilder(above);
    const n = b.hyp("n", "ℕ");
    const g0 = b.goal("g0", [n], "n + 0 = 0 + n");
    const g1 = b.goal("g1", [n], "n = 0 + n");
    const g2 = b.goal("g2", [n], "n = n");
    b.step(g0, "rw [Nat.add_zero]", [g1]);
    b.step(g1, "rw [Nat.zero_add]", [g2]);
    b.step(g2, "rfl", []);
    const f = b.finish();
    return { ...f, ids: { goal: "g1", tactic: tacticId("g1"), tail: "g2" } };
  },
};

/** a split under a `.none`: the ghost stands for the whole thing. */
const split: Scene = {
  id: "split",
  about: "G0 → constructor → (G1 → omega, G2 → simp)",
  build(above = {}) {
    const b = new SceneBuilder(above);
    const n = b.hyp("n", "ℕ");
    const g0 = b.goal("g0", [n], "0 < n + 1 ∧ n + 0 = n");
    const g1 = b.goal("g1", [n], "0 < n + 1", "left");
    const g2 = b.goal("g2", [n], "n + 0 = n", "right");
    b.step(g0, "constructor", [g1, g2]);
    const blk = b.newBlock();
    b.step(g1, "omega", [], { indent: 4, block: blk });
    const blk2 = b.newBlock();
    b.step(g2, "simp", [], { indent: 4, block: blk2 });
    const f = b.finish();
    return { ...f, ids: { goal: "g0", tactic: tacticId("g0") } };
  },
};

/** a closing `simp` with its trace: the trace leaf is minted on a click. */
const traced: Scene = {
  id: "traced",
  about: "G0 → simp (closes), with a B4 trace",
  build(above = {}) {
    const b = new SceneBuilder(above);
    const n = b.hyp("n", "ℕ");
    const g0 = b.goal("g0", [n], "n + 0 = n");
    b.step(g0, "simp", []);
    const f = b.finish();
    const at = f.starts[0];
    const proof: Proof = {
      ...f.proof,
      automationTraces: [
        {
          stepStart: at,
          tactic: "simp",
          kind: "lemmas",
          suggestion: "simp only [Nat.add_zero]",
          lemmas: [
            {
              stepStart: at,
              name: "Nat.add_zero",
              doc: "`n + 0 = n`, by the definition of addition.",
              kind: "theorem",
            },
          ],
        },
      ],
    };
    return { ...f, proof, ids: { goal: "g0", tactic: tacticId("g0") } };
  },
};

/** two steps, and room for the counterfactual stub on the line after them. */
const stub: Scene = {
  id: "stub",
  about: "G0 → rw → G1 → sorry (the cf stub is the line being typed, spliced to sorry)",
  build(above = {}) {
    const b = new SceneBuilder(above);
    const n = b.hyp("n", "ℕ");
    const g0 = b.goal("g0", [n], "n + 0 = 0 + n");
    const g1 = b.goal("g1", [n], "n = 0 + n");
    b.step(g0, "rw [Nat.add_zero]", [g1]);
    b.step(g1, "sorry", []);
    const f = b.finish();
    return { ...f, ids: { goal: "g1", tactic: tacticId("g0"), stub: tacticId("g1") } };
  },
};

export const SCENES: Record<string, Scene> = { basic, chain, split, traced, stub };

/** The steps of `proof` reachable from the one that starts at `at` — a corpus
 proof cut down to the part under one tactic, so a ledger cell is a ledger and
 its rows rather than the whole theorem.  Sidecars stay (they are keyed on
 positions, and the ones with no step left are simply never read). */
export function subProof(proof: Proof, at: Pos): Proof {
  const start = proof.steps.find(
    (s) => s.position.start.line === at.line && s.position.start.character === at.character,
  );
  if (!start) throw new Error(`no step at ${at.line}:${at.character}`);
  const byGoal = new Map<string, ProofStep[]>();
  for (const s of proof.steps) {
    const list = byGoal.get(s.goalBefore.id);
    if (list) list.push(s);
    else byGoal.set(s.goalBefore.id, [s]);
  }
  const keep = new Set<ProofStep>();
  const queue = [start];
  while (queue.length) {
    const s = queue.pop()!;
    if (keep.has(s)) continue;
    keep.add(s);
    for (const g of [...s.goalsAfter, ...s.spawnedGoals])
      for (const next of byGoal.get(g.id) ?? []) queue.push(next);
  }
  const steps = proof.steps.filter((s) => keep.has(s));
  const ids = new Set(steps.flatMap((s) => [s.goalBefore.id, ...s.goalsAfter.map((g) => g.id), ...s.spawnedGoals.map((g) => g.id)]));
  return {
    ...proof,
    steps,
    allGoals: proof.allGoals.filter((g) => ids.has(g.id)),
    comments: [],
    declHeader: undefined,
    declHeaderStart: undefined,
    declHeaderNameStop: undefined,
    declHeaderSigStop: undefined,
    declHeaderBodyStop: undefined,
    openBlock: undefined,
    cfLine: undefined,
    cfStubPos: undefined,
  };
}
