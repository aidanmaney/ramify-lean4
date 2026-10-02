/** One iterative, memoised post-order over a DAG or tree (pure, no imports).

 Every walk over a proof's nodes is iterative — a trunk is one goal per
 tactic, so recursion depth is the chain's length and a ~2500-step chain
 overflowed the stack — and every subtree fold wants the same shape: a value
 for a node from its kids' values, filled in bottom-up ONCE per node into
 `memo` (so a later ask for any finished node is O(1)). A node is entered
 once; a kid that is still unfinished when its parent comes round again is an
 ANCESTOR (a cycle no tree here has), and `get` answers `undefined` for it
 rather than looping.

 `combine(key, kids, get)` is handed the node's kids exactly as `kids` listed
 them and `get` to read their finished values. `memo` is the caller's (so it
 can be shared between roots and outlive the call). Returns `memo.get(root)`. */
export function postOrder<K, V>(
  root: K,
  kids: (k: K) => readonly K[],
  combine: (k: K, kids: readonly K[], get: (k: K) => V | undefined) => V,
  memo: Map<K, V>,
): V | undefined {
  const get = (k: K) => memo.get(k);
  const stack = [root];
  const entered = new Set<K>();
  while (stack.length > 0) {
    const at = stack[stack.length - 1];
    if (memo.has(at)) {
      stack.pop();
      continue;
    }
    const ks = kids(at);
    if (!entered.has(at)) {
      entered.add(at);
      let pushed = false;
      for (const k of ks)
        if (!memo.has(k) && !entered.has(k)) {
          stack.push(k);
          pushed = true;
        }
      if (pushed) continue;
    }
    memo.set(at, combine(at, ks, get));
    stack.pop();
  }
  return memo.get(root);
}
