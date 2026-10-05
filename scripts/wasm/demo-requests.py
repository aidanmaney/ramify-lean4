#!/usr/bin/env python3
"""Requests for the live engine over demos/playground: each theorem's solution replayed step by
step, plus tactics the bake does not table (the live tier's whole point). Prints JSONL.
usage: demo-requests.py <repo>/demos/playground > reqs.jsonl"""
import json, os, sys
D = sys.argv[1]
def f(name): return open(os.path.join(D, name + ".lean")).read()
I = lambda t: (t, 0)
cases = {
  ("Absurd", "from_false"): [([], "intro n h"), ([I("intro n h")], "omega"), ([I("intro n h")], "simp at h"),
                              ([I("intro n h")], "contradiction"), ([I("intro n h")], "grind")],
  ("AppendLength", "length_append_nat"): [([I("intro xs ys")], "induction xs"),
      ([I("intro xs ys"), I("induction xs")], "simp"), ([I("intro xs ys"), ("induction xs", 1)], "simp"),
      ([I("intro xs ys"), ("induction xs", 1), I("simp")], "omega"), ([I("intro xs ys")], "simp [List.length_append]"),
      ([I("intro xs ys")], "grind")],
  ("Double", "double_eq"): [([I("intro n"), ("induction n", 1)], "rw [double]"),
      ([I("intro n"), ("induction n", 1), I("rw [double]")], "omega"), ([I("intro n")], "unfold double; omega"),
      ([I("intro n")], "induction n <;> simp [double] <;> omega")],
  ("NoLargest", "no_largest"): [([I("intro n")], "refine ⟨n + 1, ?_⟩"), ([I("intro n")], "exact ⟨n + 1, Nat.lt_succ_self n⟩"),
      ([I("intro n")], "omega"), ([I("intro n")], "exists n + 1")],
  ("NoSqrtTwo", "no_sqrt_two_mod_five"): [([], "decide"), ([], "intro x"), ([I("intro x")], "fin_cases x"), ([I("intro x")], "revert x; decide")],
  ("SevenSquared", "seven_sq"): [([], "refine ⟨7, ?_⟩"), ([I("refine ⟨7, ?_⟩")], "rfl"), ([], "exact ⟨7, rfl⟩"), ([], "exists 7"), ([], "refine ⟨6, ?_⟩")],
  ("SquareParity", "sq_mod_two"): [([I("intro n")], "rcases Nat.mod_two_eq_zero_or_one n with h | h"),
      ([I("intro n"), I("rcases Nat.mod_two_eq_zero_or_one n with h | h")], "rw [Nat.mul_mod, h]"),
      ([I("intro n"), I("rcases Nat.mod_two_eq_zero_or_one n with h | h")], "simp [Nat.mul_mod, h]"),
      ([I("intro n")], "omega"), ([I("intro n")], "grind")],
  ("ZeroAdd", "zero_add_nat"): [([], "intro n"), ([I("intro n")], "induction n"), ([I("intro n"), ("induction n", 1)], "omega"),
      ([I("intro n")], "simp"), ([], "simp")],
  ("ZeroOrPos", "zero_or_pos"): [([I("intro n")], "cases n"), ([I("intro n"), ("cases n", 1)], "right"),
      ([I("intro n"), ("cases n", 1), I("right")], "omega"), ([I("intro n")], "omega")],
}
for (file, thm), reqs in cases.items():
    src = f(file)
    for path, tac in reqs:
        print(json.dumps({"file": src, "theorem": thm, "path": [list(p) for p in path], "tactic": tac}, ensure_ascii=False))
