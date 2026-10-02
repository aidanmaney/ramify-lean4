// The frontier chips' words and rows, pure. A pending goal draws up to four
// chips (`+`/`?_`, `sorry`, `calc`, `step`) and the goal's `⋯` menu carries the
// same four as rows so the keyboard reaches them; both read ONE description
// here, so the chip's tip and the menu's row cannot drift apart. Handlers are
// the view's own closures — each row runs the chip's, never a second copy.
import type { NodeMove } from "./nodeBar";
import type { CalcRelOption } from "./paperproof";
import type { AddSpec } from "./types";
import { MENU_ICON } from "./menuIcons";

export const HOLE_GLYPH = "?_";
export const addChipGlyph = (spec: AddSpec | undefined) =>
  spec?.kind === "hole" ? HOLE_GLYPH : "+";

/** The node data the chips are decided from. */
export interface ChipData {
  addSpec?: AddSpec;
  addLink?: AddSpec;
  calcRels?: CalcRelOption[];
}

export type ChipKind = "add" | "sorry" | "calc" | "step";

export interface ChipCopy {
  /** The `⋯` row's words. */
  label: string;
  /** The row's tip. */
  menuTitle: string;
  /** The chip's own tip. */
  title: string;
}

const relList = (os: readonly CalcRelOption[] | undefined) =>
  (os ?? []).map((o) => o.rel).join(" ");

/** Every chip this node offers, with its copy. */
export function chipCopy(d: ChipData): Partial<Record<ChipKind, ChipCopy>> {
  const out: Partial<Record<ChipKind, ChipCopy>> = {};
  if (d.addSpec) {
    const hole = d.addSpec.kind === "hole";
    out.add = {
      label: hole ? "Fill this `?_` in place" : "Add a tactic here",
      menuTitle: "Add a tactic here",
      title: hole
        ? "fill this hole in place — what you type replaces the `?_` where it sits"
        : "add a tactic for this goal",
    };
    out.sorry = {
      label: "Stub this goal with `sorry`",
      menuTitle: "Stub this goal with `sorry`",
      title: "stub this goal with `sorry`",
    };
  }
  if (d.calcRels) {
    const many = d.calcRels.length > 1;
    out.calc = {
      label: "Start a `calc` chain",
      menuTitle: "Start a `calc` chain",
      title: many
        ? `start a calc chain — pick its relation (${relList(d.calcRels)}); writes one line, \`calc _ … _ := by sorry\`, then asks for each side`
        : `start a calc chain — writes \`calc _ ${d.calcRels[0].rel} _ := by sorry\`, then asks for each side (Enter keeps \`_\`)`,
    };
  }
  const link = d.addLink;
  if (link) {
    const many = (link.rels?.length ?? 0) > 1;
    out.step = {
      label:
        link.kind === "calc-first"
          ? "Write the `calc` block's first link"
          : link.kind === "calc-append"
            ? many
              ? "Add the next link to this chain"
              : `Close this chain with a \`${link.rel}\` link`
            : "Add a `calc` step above this link",
      menuTitle: "Add a `calc` step",
      title: link.chain?.broken
        ? link.kind === "calc-first"
          ? "write this `calc` block's first link, then fill in each side. Until it has one it does not parse, which is why the rest of this proof is missing"
          : `finish the \`calc\` block: add its next ${link.rel} link. Until then it does not parse, which is why the rest of this proof is missing`
        : link.kind === "calc-append"
          ? many
            ? `add the next link to this chain — pick its relation (${relList(link.rels)}); \`${link.rel}\` closes the chain, anything else adds a step and leaves it open`
            : `close this chain with a \`${link.rel}\` link — type its right-hand side, or keep the \`_\` to end it here`
          : "add a calc step above this link — the new link appears above this box, and this one closes the remainder; type its right-hand side",
    };
  }
  return out;
}

/** A chip's `⋯` row as plain data — the view adds the `onClick` (its own
 closure for that chip), because a pure function handed ref-touching closures
 would read as a ref access during render to the compiler lint. */
export type ChipRow = Omit<NodeMove, "onClick"> & { kind: ChipKind };

/** The rows for the chips this node offers, in the chips' own order. */
export function chipRows(d: ChipData): ChipRow[] {
  const copy = chipCopy(d);
  const row = (kind: ChipKind, glyph: string, chip: boolean): ChipRow[] => {
    const c = copy[kind];
    return c
      ? [
          {
            kind,
            glyph,
            ...(chip
              ? { chip: true }
              : glyph === HOLE_GLYPH
                ? {}
                : { menuIcon: MENU_ICON.plus }),
            label: c.label,
            title: c.menuTitle,
            shortcut: "click the chip",
          },
        ]
      : [];
  };
  return [
    ...row("add", addChipGlyph(d.addSpec), false),
    ...row("sorry", "sorry", true),
    ...row("calc", "calc", true),
    ...row("step", "step", true),
  ];
}
