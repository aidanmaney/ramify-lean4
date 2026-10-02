// Deterministic synthetic proofs (shared by perf.mjs and fingerprint.mjs).
// A deterministic proof generator.  Shapes:
//   chain  a single spine of linear steps (intro/rw/simp…), closed by `omega`
//   split  a balanced binary tree of `constructor` splits, each leaf a chain of 1 step
//   mixed  what real proofs look like: linear steps, a `have … := by` block
//          every 7th, a `constructor` split every 7th (budget halves), hyps
//          growing to a cap, a comment every 10th step
export function synth(shape, target) {
  let g = 0, h = 0, line = 10;
  const steps = [], allGoals = [], comments = [];
  const newHyp = (name, type) => ({ id: `_uniq.h${h++}`, isProof: "data", type, username: name, value: null });
  const newGoal = (hyps, type, username = "[anonymous]") => { const gl = { id: `_uniq.g${g++}`, hyps, type, username }; allGoals.push(gl); return gl; };
  const HCAP = 6;
  const pos = (indent) => { const l = line++; return { start: { line: l, character: indent }, stop: { line: l + 1, character: indent } }; };
  const step = (goal, tactic, after, spawned, indent) => {
    const position = pos(indent);
    const dep = goal.hyps.length ? [goal.hyps[goal.hyps.length - 1].id] : [];
    steps.push({ tacticString: tactic, goalBefore: goal, goalsAfter: after, spawnedGoals: spawned, tacticDependsOn: dep, position, theorems: [] });
    if (steps.length % 10 === 0)
      comments.push({ text: `-- step ${steps.length}: what this step is for, in a sentence or so.`, start: { line: position.start.line - 0, character: indent }, stop: { line: position.start.line, character: indent + 50 } });
  };
  const LIN = ["intro x", "rw [add_comm]", "simp only [add_zero]", "unfold f", "norm_num", "apply foo", "rw [h] at hx"];
  let counter = 0;
  const linear = (goal, indent) => {
    const t = LIN[counter++ % LIN.length];
    const hyps = goal.hyps.length < HCAP ? [...goal.hyps, newHyp(`x${counter}`, "ℕ")] : goal.hyps;
    const next = newGoal(hyps, `f (${counter} + n) = g n + ${counter} ∧ n ≤ ${counter * 3}`);
    step(goal, t, [next], [], indent);
    return next;
  };
  const close = (goal, indent) => { step(goal, "omega", [], [], indent); };
  // budget = number of steps still to emit under this goal
  function block(goal, budget, indent, depth) {
    let i = 0;
    while (budget > 0) {
      if (shape === "mixed" && i % 7 === 3 && budget >= 10) {
        const a = newGoal(goal.hyps, "A ∧ B", "left"), b = newGoal(goal.hyps, "C = D", "right");
        step(goal, "constructor", [a, b], [], indent);
        const rest = budget - 1, half = rest >> 1;
        block(a, half, indent + 2, depth + 1);
        block(b, rest - half, indent + 2, depth + 1);
        return;
      }
      if (shape === "mixed" && i % 7 === 0 && budget >= 8) {
        const sp = newGoal(goal.hyps, `∀ m : ℕ, P m ${i}`), cont = newGoal([...goal.hyps.slice(0, HCAP - 1), newHyp(`key${i}`, "∀ m, P m")], goal.hyps.length ? "⊢ rest" : "rest");
        step(goal, `have key${i} : ∀ m : ℕ, P m ${i} := by`, [cont], [sp], indent);
        block(sp, 3, indent + 2, depth + 1);
        goal = cont; budget -= 4; i++;
        continue;
      }
      if (budget === 1) { close(goal, indent); return; }
      goal = linear(goal, indent); budget--; i++;
    }
    if (budget <= 0 && goal) close(goal, indent);
  }
  function splitTree(goal, n, indent) {
    if (n <= 2) { close(goal, indent); return 1; }
    const a = newGoal(goal.hyps, "A", "left"), b = newGoal(goal.hyps, "B", "right");
    step(goal, "constructor", [a, b], [], indent);
    const half = (n - 1) >> 1;
    return 1 + splitTree(a, half, indent + 2) + splitTree(b, n - 1 - half, indent + 2);
  }
  const root = newGoal([newHyp("n", "ℕ")], "f n = g n ∧ n ≤ 3");
  if (shape === "split") splitTree(root, target, 2);
  else block(root, target, 2, 0);
  return { steps, allGoals, comments, holes: [], calcChains: [], calcRelations: [], deleteSlots: [], declRange: { start: { line: 2, character: 0 }, stop: { line, character: 0 } } };
}
