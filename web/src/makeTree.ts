import type { HypLine, ParentEdge, TreeNode } from "./types";

// Deterministic PRNG (mulberry32) so a given seed always builds the SAME tree.
// Reproducibility matters here: you want to compare layout options on an
// identical tree, and re-renders/HMR must not reshuffle the data.
function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TALL_TACTICS = [
  "induction n with\n| zero => simp\n| succ k ih => rw [ih]", // 3 lines
  "rcases h with ⟨a, b⟩ |\n⟨c, d⟩", // 2 lines
  "calc a = b := by ring\n  _ = c := by linarith", // 2 lines
];

const TACTICS = [
  "intro",
  "cases h",
  "induction n",
  "rw [foo]",
  "simp",
  "apply le_trans",
  "constructor",
  "exact h",
];

// Sample local contexts (hypotheses) shown along the edge into each subgoal.
const HYPS = [
  "A B : Prop\nh : A ∧ B",
  "n : ℕ\nih : P n",
  "x : α\nhx : p x",
  "f : α → β\ng : β → γ",
  "h₁ : a ≤ b\nh₂ : b ≤ c",
  "ε : ℝ\nhε : 0 < ε",
];

// Cheap deterministic string hash (FNV-1a). Used to pick a stable hypothesis per
// edge from its child id, independent of the tree-shape PRNG so adding this
// doesn't reshuffle the generated tree.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Structured like a real goal context (see types.ts HypLine): line texts plus a
// deterministic "used by this tactic" flag so the marker gutter is exercised.
const pickHyp = (goalId: string): HypLine[] => {
  const n = hash(goalId);
  return HYPS[n % HYPS.length]
    .split("\n")
    .map((text, i) => ({ text, used: (n >> i) % 3 === 0 }));
};

/**
 * Build an alternating goal/tactic tree.
 * @param depth     number of goal levels (depth 1 = a single closed goal)
 * @param branching max goals a tactic spawns
 * @param seed      PRNG seed; same seed = same tree
 * @param jitter    if true, each tactic spawns 1..branching goals (asymmetric);
 *                  if false, always exactly `branching` (symmetric, full tree)
 */
export function makeTree(
  depth: number,
  branching: number,
  seed = 42,
  jitter = true,
): TreeNode[] {
  const rand = mulberry32(seed);

  const nodes: TreeNode[] = [];

  // goal/tactic now take the PARENT edge(s) and register themselves against them,
  // rather than returning a subtree to be attached by the caller.
  function goal(level: number, path: string, parents: ParentEdge[]): string {
    const id = `⊢ goal ${path}`; // unique address-based id
    // A goal carries its own local context, drawn inside its box (root goals
    // included — they'd hold the theorem's binders).
    nodes.push({ id, label: id, type: "goal", parents, hyps: pickHyp(id) });
    if (level < depth) {
      tactic(level, path, [{ id }]); // this goal is the tactic's parent
    }
    return id; // return id so callers can link to it
  }

  function tactic(level: number, path: string, parents: ParentEdge[]): string {
    const pickTall = jitter && rand() < 0.4;
    const pool = pickTall ? TALL_TACTICS : TACTICS;
    const base = pool[Math.floor(rand() * pool.length)];
    const id = `${base} (${path})`; // path suffix keeps it unique
    nodes.push({ id, label: id, type: "tactic", parents });
    if (level < depth - 1) {
      const n = jitter ? 1 + Math.floor(rand() * branching) : branching;
      for (let i = 0; i < n; i++) {
        goal(level + 1, `${path}.${i}`, [{ id }]);
      }
    }
    return id;
  }

  goal(0, "0", []); // root has no parents
  return nodes;
}
