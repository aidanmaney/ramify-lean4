import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";

import {
  GESTURES,
  GESTURE_SECTIONS,
  type Caps,
  type Gesture,
} from "./gestures";
import {
  CHROME_INK,
  FLOATER_CHROME,
  CHROME_TEXT,
  DIM_OPACITY,
} from "./theme";
import { injectStyleOnce } from "./taggedRender";
import { useTip } from "./tipController";
import { CodeText } from "./codeSpans";
import { focusBox, useRestoreFocus } from "./panelKeys";
import { BARE_BTN } from "./barMetrics";

const INK = CHROME_INK;

// Sentence case, told from the rows by weight (not capitals) and a dim.
const SECTION_HEAD = {
  fontWeight: 600,
  opacity: DIM_OPACITY,
  marginTop: 8,
} as const;

// Under ~360px of frame the panel is ~285px of content: too narrow for an
// input column beside its explanation, so each row STACKS (input above says).
// A container query on the grid's wrapper (the panel's own width decides).
const HELP_CSS = `
[data-ptw-help-wrap]{container-type:inline-size}
@container (max-width: 289px){
  [data-ptw-help-grid]{grid-template-columns:minmax(0,1fr)!important}
  [data-ptw-help-input]{text-align:left!important;opacity:${DIM_OPACITY};margin-top:4px}
}`;

export function HelpPanel({
  caps,
  fontFamily,
  onClose,
  anchor,
}: {
  caps: Caps;

  fontFamily: string;
  onClose: () => void;
  /** Where the panel hangs from its positioned ancestor. It lives on the
  status bar's `?` item, which sits at the BOTTOM of the frame, so the default
  is "above, right-aligned" — a panel hung downward from there would be
  entirely below the fold. Passed in rather than hardcoded so the anchor is
  stated where the button is. */
  anchor?: CSSProperties;
}) {
  const shown = GESTURES.filter((g) => !g.needs || caps[g.needs]);
  const tip = useTip();
  const ref = useRef<HTMLDivElement | null>(null);
  // Opened from the keyboard (`?`, F1, Enter on the button), focus moves into
  // the panel so its text can be read and scrolled at once; opened with the
  // mouse, nothing moves. Closing hands focus back to whatever had it if it
  // was inside the panel.
  useRestoreFocus(ref, focusBox);
  // HUNG FROM ITS ITEM like every panel — by the `?` item's RIGHT edge (it is
  // the last item in the row, so a left-hung 320px panel would run off the
  // frame). Paint only: `left` and a clamp transform written to the element,
  // measured from the strip (its containing block) and the frame.
  useLayoutEffect(() => {
    const el = ref.current;
    const strip = el?.offsetParent as HTMLElement | null;
    if (!el || !strip) return;
    const btn = Array.from(
      strip.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"][aria-expanded="true"]'),
    ).find((b) => !b.closest("[data-g]"));
    if (!btn) return;
    const frame = (strip.offsetParent as HTMLElement | null) ?? strip;
    const sr = strip.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    el.style.transform = "";
    el.style.left = `${br.right - sr.left - strip.clientLeft - el.offsetWidth}px`;
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const dx = Math.max(Math.min(0, f.right - 4 - r.right), f.left + 4 - r.left);
    if (dx !== 0) el.style.transform = `translateX(${dx}px)`;
  });
  injectStyleOnce("ptw-help", HELP_CSS);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Help"
      tabIndex={-1}
      data-ptw-panel=""
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        ...(anchor ?? { left: 0, bottom: "100%", marginBottom: 4 }),
        width: 320,
        maxWidth: "min(320px, 86vw)",
        maxHeight: "min(70vh, 520px)",
        overflowY: "auto",
        boxSizing: "border-box",
        ...FLOATER_CHROME,
        // A document, not a list: the one floater with a roomier inset.
        padding: "10px 12px",
        color: INK,
        fontSize: CHROME_TEXT,
        lineHeight: 1.5,
        textAlign: "left",
        // The panel now hangs off the status bar, whose card sets
        // `white-space: nowrap` for its own one-line items — inherited here it
        // ran every hint line straight off the panel's right edge.
        whiteSpace: "normal",
        cursor: "default",
        outline: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",

          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <button
          type="button"
          {...tip.props("Close (Esc, or ?)")}
          onClick={onClose}
          style={{
            ...BARE_BTN,
            fontSize: CHROME_TEXT,
            opacity: DIM_OPACITY,
          }}
        >
          ✕
        </button>
      </div>
      {/* What the picture is, before what can be done to it. Colours are the
          theme's, so none is named: goals and tactics are told apart by what
          is written in them. */}
      <div style={{ display: "grid", rowGap: 2 }}>
        <div style={SECTION_HEAD}>Reading this</div>
        <div>
          A <b>goal</b> is a statement still to prove, with what you may assume
          (its hypotheses) listed above the ⊢ line.
        </div>
        <div>
          A <b>tactic</b> is the step that turns a goal into what remains.
        </div>
        <div>
          Read from the top down. Where a step splits a goal, the branches are
          its cases or subgoals.
        </div>
      </div>
      {/* ONE grid for every section, so the input column is shared: as wide as
          the longest input up to 46% of the panel, wrapping beyond that, so no
          input is cut with `…` and the explanation keeps most of the width. */}
      <div data-ptw-help-wrap="">
      <div
        data-ptw-help-grid=""
        style={{
          display: "grid",
          gridTemplateColumns: "fit-content(46%) minmax(0, 1fr)",
          columnGap: 8,
          rowGap: 2,
        }}
      >
        {GESTURE_SECTIONS.map((s) => {
          const rows = shown.filter((g) => g.target === s.target);
          if (rows.length === 0) return null;
          return (
            <Fragment key={s.target}>
              <div
                style={{
                  gridColumn: "1 / -1",
                  ...SECTION_HEAD,
                }}
              >
                <CodeText text={s.title} />
              </div>
              {rows.map((g, i) => (
                <Row key={i} g={g} fontFamily={fontFamily} />
              ))}
            </Fragment>
          );
        })}
      </div>
      </div>
    </div>
  );
}

function Row({ g, fontFamily }: { g: Gesture; fontFamily: string }) {
  return (
    <>
      <span
        data-ptw-help-input=""
        style={{
          fontFamily,
          textAlign: "right",
          overflowWrap: "anywhere",
        }}
      >
        {g.input}
      </span>
      <span style={{ minWidth: 0 }}>
        <CodeText text={g.says.replace(/^to /, "")} />
      </span>
    </>
  );
}
