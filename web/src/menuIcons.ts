// Icons for the `⋯` menu's rows that have no bar button to borrow one from
// (edit, comment, marks, rename, fold): drawn in the bar's own stroke on the
// same 14×14 grid (`-7 -7 14 14`), each SELF-WRAPPED in the stroke group, so
// every row of the menu has an icon and a `NodeMove` carries its own
// (`menuIcon`) instead of the menu guessing one from the glyph's text. A `.ts`
// file built with `createElement`, as moveSlots.ts is — a component file must
// export only components (fast refresh).
import { createElement as h, type ReactNode } from "react";
import { CHROME_RADIUS } from "./theme";
import { HOVER_ICON_SW } from "./barMetrics";

const rx = CHROME_RADIUS - 1;
const stroked = (...kids: ReactNode[]): ReactNode =>
  h(
    "g",
    {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: HOVER_ICON_SW,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    ...kids,
  );
const path = (d: string): ReactNode => h("path", { d });
const box = h("rect", { x: -4.5, y: -4.5, width: 9, height: 9, rx });
const tab = (extra?: object): ReactNode =>
  h("rect", { x: -4.5, y: -2.5, width: 9, height: 5, rx, ...extra });

export const MENU_ICON = {
  plus: stroked(box, path("M-2 0H2M0 -2V2")),
  minus: stroked(box, path("M-2 0H2")),
  edit: stroked(path("M-3.5 4L-3 1.4L2.4 -4L4 -2.4L-1.4 3ZM1 -2.6L2.6 -1")),
  comment: stroked(path("M-4.5 -3.5H4.5V2H-0.5L-3 4.2V2H-4.5Z")),
  mark: stroked(tab({ strokeDasharray: "2 1.6" })),
  unmark: stroked(tab(), path("M-3.5 3.5L3.5 -3.5")),
  writeMark: stroked(tab(), path("M-1.5 0H1.5M0 -1.5V1.5")),
} as const;
