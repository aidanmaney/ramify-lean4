// NAME THE CASES — a split that left its new hypotheses inaccessible (`h✝`,
// `n✝`, `a✝`) rewritten into the form that names them, one alternative per case:
//
//   cases h                    cases h with
//                       →      | inl h => sorry
//                              | inr h => sorry
//
// The names are the ones Lean already printed with the dagger dropped (`n✝` →
// `n`, `head✝¹` → `head`), the induction hypothesis Lean calls `a✝` becomes
// `ih`, and a name the case's goal already shows is primed. Bodies are `sorry`
// — the standing rule: leave the author's text unfinished rather than finish
// it for them (CLAUDE.md, "Standing rules"). Pure: the view's Quick Fix (both
// wires) and the playground's goal panel call the same function.

/** One case the split left: its tag (`inl`, `succ`, `cons`) and the names it
 printed, the inaccessible ones (with the dagger) in context order. */
export interface SplitArm {
  tag: string;
  /** Every hypothesis name the case's goal shows, in context order. */
  names: string[];
  /** The ones the split introduced (by name; inaccessible ones carry `✝`). */
  introduced: string[];
}

/** The tactics this applies to: a split by `cases`/`induction` written WITHOUT
 alternatives (the head word, then one target, nothing after). */
const SPLIT = /^(cases|induction)\s+(\S+)$/;

export const isUnnamedSplit = (text: string): boolean => SPLIT.test(text.trim());

const DAGGER = /✝[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/;
export const isInaccessible = (name: string): boolean => DAGGER.test(name);

/** The name a reader would give an inaccessible hypothesis. */
function baseName(name: string): string {
  const b = name.replace(DAGGER, "");
  return b === "a" ? "ih" : b;
}

/** The rewritten split, or null when there is nothing to name (no case tag,
 or no inaccessible hypothesis in any case). `indent` is the column the split
 stands at: the alternatives line up under it, as Lean's style has them. */
export function nameCasesText(text: string, indent: number, arms: SplitArm[]): string | null {
  const m = text.trim().match(SPLIT);
  if (!m || arms.length === 0 || arms.some((a) => !a.tag)) return null;
  if (!arms.some((a) => a.introduced.some(isInaccessible))) return null;
  const pad = " ".repeat(indent);
  const lines = arms.map((a) => {
    const taken = new Set(a.names.filter((n) => !isInaccessible(n)));
    const binders = a.introduced.filter(isInaccessible).map((n) => {
      let b = baseName(n);
      while (taken.has(b)) b += "'";
      taken.add(b);
      return b;
    });
    return `${pad}| ${[a.tag, ...binders].join(" ")} => sorry`;
  });
  return [`${m[1]} ${m[2]} with`, ...lines].join("\n");
}
