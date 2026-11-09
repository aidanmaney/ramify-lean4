// The tree's LINKS: every edge between placed nodes, the cursor's path drawn
// last (on top), with their marks, tints, case-badge lifts and the hop chip
// and caption on a hopped goal's link. Split out of ProofTreeView.tsx.
import {
  caseBadgeLifts,
  ARROW_GAP,
  LINK_MARK_OFF,
  TRUNK_INSET,
  bandTopH,
  BADGE_H,
} from "./layout";
import {
  LINK_STROKE,
  LINK_STROKE_GOAL,
  LINK_STROKE_TACTIC,
  SEQ_STROKE,
  TREE_INK_SW_BOLD,
  TREE_INK_SW_PATH,
} from "./theme";
import { HopChip, LinkMark } from "./topChrome";
import type { PlacedLink } from "./types";

export function TreeLinks({
  links,
  compact,
  caseLifts,
  cursorPathLinks,
  linkMarks,
  linkTint,
  onNodeClick,
}: {
  links: readonly PlacedLink[];
  compact: boolean;
  caseLifts: ReturnType<typeof caseBadgeLifts> | null;
  cursorPathLinks: ReadonlySet<string>;
  linkMarks: boolean;
  linkTint: boolean;
  onNodeClick: (id: string) => void;
}) {
  return (
    <>
      {links
        .map((link, i) => ({ link, i }))
        .sort(
          (a, b) =>
            Number(
              cursorPathLinks.has(
                `${a.link.source.data.id}>${a.link.target.data.id}`,
              ),
            ) -
            Number(
              cursorPathLinks.has(
                `${b.link.source.data.id}>${b.link.target.data.id}`,
              ),
            ),
        )
        .map(({ link, i }) => {
          const startY =
            link.source.y +
            (link.source.data.h + bandTopH(link.source.data)) / 2;
          const bandTop =
            link.target.y -
            (link.target.data.h + bandTopH(link.target.data)) / 2;

          const contentTop = bandTop + bandTopH(link.target.data);
          // A wide case badge raised to its siblings' line
          // (`caseBadgeLifts`): the link ends above it, not through it.
          const endY =
            bandTop - (caseLifts?.get(link.target.data.id) ?? 0) - ARROW_GAP;

          const sLeft = link.source.x - link.source.data.w / 2;
          const tLeft = link.target.x - link.target.data.w / 2;

          const MARK_FIT = LINK_MARK_OFF + 5;
          const MARK_FIT2 = 2 * LINK_MARK_OFF + 9;

          const MARK_MIN = 10;
          type Mark = { x: number; y: number; horiz?: boolean };
          let startMark: Mark | null = null;
          let endMark: Mark | null = null;

          const markAt = (run: number, fromStart: boolean) =>
            run >= MARK_FIT
              ? fromStart
                ? LINK_MARK_OFF
                : run - LINK_MARK_OFF
              : run >= MARK_MIN
                ? run / 2
                : null;

          const sharedMarks = (x: number, y0: number, y1: number) => {
            const run = y1 - y0;
            if (run >= MARK_FIT2) {
              startMark = { x, y: y0 + LINK_MARK_OFF };
              endMark = { x, y: y1 - LINK_MARK_OFF };
            } else {
              const o = markAt(run, true);
              if (o !== null) startMark = { x, y: y0 + o };
            }
          };

          const branchMarks = (x0: number, x1: number, y: number) => {
            const run = x1 - x0;
            if (run >= MARK_FIT2) {
              startMark = { x: x0 + LINK_MARK_OFF, y, horiz: true };
              endMark = { x: x1 - LINK_MARK_OFF, y, horiz: true };
            } else {
              const o = markAt(run, true);
              if (o !== null) startMark = { x: x0 + o, y, horiz: true };
            }
          };
          let d: string;
          // Where the link LEAVES its source and where that first
          // vertical run ends, for the hop break drawn at its midpoint.
          let hopX = link.source.x;
          let hopY = startY;
          let hopEnd = endY;
          if (compact && link.col) {
            const col = sLeft + TRUNK_INSET;
            const childLane = tLeft + TRUNK_INSET;
            const hy = bandTop - ARROW_GAP * 2;
            hopX = col;
            hopEnd = hy;
            d = `M${col},${startY} L${col},${hy} L${childLane},${hy} L${childLane},${contentTop - ARROW_GAP}`;

            const o1 = markAt(childLane - col, true);
            if (o1 !== null) startMark = { x: col + o1, y: hy, horiz: true };
            const o2 = markAt(contentTop - ARROW_GAP - hy, false);
            if (o2 !== null) endMark = { x: childLane, y: hy + o2 };
          } else if (compact && link.lane !== undefined) {
            const lane = link.lane;
            const srcBoxMid = link.source.y + bandTopH(link.source.data) / 2;
            hopX = lane;
            hopY = srcBoxMid;
            hopEnd = contentTop - ARROW_GAP;
            if (Math.abs(tLeft - (lane - TRUNK_INSET)) < 0.5) {
              d = `M${lane},${srcBoxMid} L${lane},${contentTop - ARROW_GAP}`;

              const o = markAt(contentTop - ARROW_GAP - srcBoxMid, false);
              if (o !== null) endMark = { x: lane, y: srcBoxMid + o };
            } else {
              const landY = contentTop + link.target.data.h / 2;
              d = `M${lane},${srcBoxMid} L${lane},${landY} L${tLeft - ARROW_GAP},${landY}`;
              if (tLeft - ARROW_GAP > lane)
                branchMarks(lane, tLeft - ARROW_GAP, landY);
              else {
                const o = markAt(landY - srcBoxMid, true);
                if (o !== null) startMark = { x: lane, y: srcBoxMid + o };
              }
            }
          } else if (compact) {
            const col = sLeft + TRUNK_INSET;
            hopX = col;
            hopEnd = contentTop - ARROW_GAP;
            if (Math.abs(tLeft - sLeft) < 0.5) {
              d = `M${col},${startY} L${col},${contentTop - ARROW_GAP}`;
              sharedMarks(col, startY, contentTop - ARROW_GAP);
            } else {
              const landY = contentTop + link.target.data.h / 2;
              d = `M${col},${startY} L${col},${landY} L${tLeft - ARROW_GAP},${landY}`;

              if (tLeft - ARROW_GAP > col)
                branchMarks(col, tLeft - ARROW_GAP, landY);
              else {
                const o = markAt(landY - startY, true);
                if (o !== null) startMark = { x: col, y: startY + o };
              }
            }
          } else {
            const startX = link.source.x;
            const endX = link.target.x;
            const k = (endY - startY) * 0.7;
            // ⑃ wide, a HOP whose kept goal sits off to one side: the
            // break is drawn for a VERTICAL line at the midpoint below the
            // goal, so the link drops straight through it (and past the
            // caption beside it) before it curves away — otherwise the
            // strokes stood beside a curve that had already left.
            const breakRun =
              link.source.data.folded?.kind === "hop" &&
              Math.abs(endX - startX) > 0.5;
            const y1 = (startY + endY) / 2 + BADGE_H / 2 + 2;
            d = breakRun
              ? `M${startX},${startY} L${startX},${y1}
          C${startX},${(y1 + endY) / 2}
           ${endX},${(y1 + endY) / 2}
           ${endX},${endY}`
              : `M${startX},${startY}
          C${startX},${(startY + endY) / 2}
           ${endX},${endY - k}
           ${endX},${endY}`;
          }

          const goalBound = link.target.data.type === "goal";
          const onPath = cursorPathLinks.has(
            `${link.source.data.id}>${link.target.data.id}`,
          );
          const stroke = onPath
            ? SEQ_STROKE
            : linkTint
              ? goalBound
                ? LINK_STROKE_GOAL
                : LINK_STROKE_TACTIC
              : LINK_STROKE;
          return (
            <g key={i}>
              <path
                fill="none"
                stroke={stroke}
                strokeWidth={onPath ? TREE_INK_SW_PATH : TREE_INK_SW_BOLD}
                d={d}
              />
              {linkMarks && startMark && (
                <LinkMark {...startMark} goal={goalBound} stroke={stroke} />
              )}
              {linkMarks && endMark && (
                <LinkMark {...endMark} goal={goalBound} stroke={stroke} />
              )}
              {link.source.data.folded?.kind === "hop" && (
                <HopChip
                  x={hopX}
                  y={(hopY + hopEnd) / 2}
                  folded={link.source.data.folded}
                  onRestore={() => onNodeClick(link.source.data.id)}
                />
              )}
            </g>
          );
        })}
    </>
  );
}
