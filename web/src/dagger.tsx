// THE DAGGER'S PAINT — Lean's inaccessible-name marker `✝` drawn raised,
// and smaller (in its text's own ink: one dimming at most, 2026-10-25), so `n✝` reads as a marked name rather than `nt`. The
// MEASURER is layout.ts `measureText` (it charges each dagger at
// `DAGGER_SCALE`); these two painters are its pair, one per surface: SVG text
// (the plain label and context paths) and HTML (the tagged/baked code path).
// Both do nothing where `smallDaggersOn()` is off (the widget).
import type { ReactNode } from "react";
import {
  DAGGER,
  DAGGER_LIFT,
  DAGGER_SCALE,
  smallDaggersOn,
} from "./layout";

/** `text` for an SVG `<text>`/`<tspan>` at `fontPx`: each dagger a raised,
 shrunk tspan, the baseline restored after it. */
export function daggerSvg(text: string, fontPx: number): ReactNode {
  if (!smallDaggersOn() || !text.includes(DAGGER)) return text;
  const parts = text.split(DAGGER);
  const lift = DAGGER_LIFT * fontPx;
  const out: ReactNode[] = [parts[0]];
  let up = false;
  for (let i = 1; i < parts.length; i++) {
    out.push(
      <tspan
        key={`d${i}`}
        dy={up ? 0 : -lift}
        fontSize={DAGGER_SCALE * fontPx}
      >
        {DAGGER}
      </tspan>,
    );
    up = true;
    if (parts[i] !== "") {
      out.push(
        <tspan key={`t${i}`} dy={lift}>
          {parts[i]}
        </tspan>,
      );
      up = false;
    }
  }
  // Ending on a dagger: the baseline comes back on a zero-width space (a
  // default-ignorable character, no advance), so whatever SIBLING follows —
  // a context line's ` : type` after its names — is not drawn lifted. `dy`
  // rather than `baseline-shift`, which Firefox does not implement.
  if (up)
    out.push(
      <tspan key="r" dy={lift}>
        {"\u200b"}
      </tspan>,
    );
  return out;
}

// Built on first use, not at module load: theme.ts and layout.ts import
// each other's neighbours, and a constant read here at load was undefined.
const daggerStyle = () =>
  ({
    fontSize: `${DAGGER_SCALE}em`,
    position: "relative",
    // `top` is in the SPAN'S em; the lift is the surrounding text's.
    top: `-${(DAGGER_LIFT / DAGGER_SCALE).toFixed(3)}em`,
  }) as const;

/** `text` for HTML: each dagger a raised, shrunk span (`position: relative`,
 so the line box does not grow). */
export function daggerHtml(text: string): ReactNode {
  if (!smallDaggersOn() || !text.includes(DAGGER)) return text;
  const parts = text.split(DAGGER);
  const out: ReactNode[] = [parts[0]];
  const style = daggerStyle();
  for (let i = 1; i < parts.length; i++)
    out.push(
      <span key={`d${i}`} style={style}>
        {DAGGER}
      </span>,
      parts[i],
    );
  return out;
}
