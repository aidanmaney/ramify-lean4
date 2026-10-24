// THE DOC CARD — the popover a hovered constant shows: its `expr : type` line,
// a rule, then its DOCSTRING. ONE place for both doors into it: a baked goal
// subterm (`BakedCode`, the static viewer and the playground) and a tactic
// token with a docstring (`DocTokenSpan`, every surface).
//
// A docstring is markdown, often long and with fenced examples. The card
// shows its FIRST PARAGRAPH (inline `code` in the code font, as `CodeText`
// draws it) and a `More…` toggle for the rest, rendered as simple markdown —
// paragraphs, inline code, fenced blocks as <pre> — inside a max-height that
// scrolls. It is kept inside the viewport (flipped above its anchor where it
// would run off the bottom), sits BELOW the node menu (`Z.hover`), never opens
// from a right-click, and takes the pointer so `More…` can be clicked: leaving
// the anchor closes it after a short grace, which entering the card cancels.
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { docBlocks, docLead, inlinePlain } from "./docMarkdown";
import { useDocHover } from "./docHover";
import { createPortal } from "react-dom";
import { CodeText } from "./codeSpans";
import { getCodeFontFamily } from "./layout";
import {
  CHROME_TEXT_SM,
  FLOATER_CHROME,
  Z,
  chromeScopeProps,
} from "./theme";

const CARD_MAX_W = 440;
const CARD_MAX_H = 320;
const EDGE = 4;
const GAP = 4;

function DocRest({ md }: { md: string }): ReactNode {
  const blocks = docBlocks(md);
  const lead = blocks.findIndex((b) => b.kind === "para");
  return blocks.map((b, i) =>
    i === lead ? null : b.kind === "code" ? (
      <pre
        key={i}
        style={{
          margin: "6px 0 0",
          fontFamily: getCodeFontFamily(),
          fontSize: "0.94em",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {b.text}
      </pre>
    ) : (
      <p key={i} style={{ margin: "6px 0 0" }}>
        <CodeText text={inlinePlain(b.text)} />
      </p>
    ),
  );
}

// ---------------------------------------------------------------- the card

/** Every pointer/mouse event inside the card stays inside it: the card is a
 portal OWNED by a span inside a node, and React bubbles through the portal —
 a click on `More…` must not reveal the step or start a marquee. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

export function DocCard({
  anchor,
  head,
  doc,
  onEnter,
  onLeave,
}: {
  anchor: DOMRect;
  head?: string;
  doc?: string;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const { lead, more } = doc ? docLead(doc) : { lead: "", more: false };

  // Keep the card in the viewport: measured, then placed by writing its
  // style (never state — a placement is paint).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.maxHeight = `${Math.max(80, Math.min(CARD_MAX_H, vh - 2 * EDGE))}px`;
    const r = el.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(anchor.left, vw - r.width - EDGE));
    let top = anchor.bottom + GAP;
    if (top + r.height > vh - EDGE) {
      const above = anchor.top - GAP - r.height;
      top = above >= EDGE ? above : Math.max(EDGE, vh - EDGE - r.height);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }, [anchor, expanded, doc, head]);

  return createPortal(
    <div
      {...chromeScopeProps()}
      ref={ref}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onWheel={stop}
      style={{
        ...FLOATER_CHROME,
        position: "fixed",
        left: anchor.left,
        top: anchor.bottom + GAP,
        visibility: "hidden",
        zIndex: Z.hover,
        maxWidth: CARD_MAX_W,
        maxHeight: CARD_MAX_H,
        overflowY: "auto",
        fontSize: CHROME_TEXT_SM,
        lineHeight: "15px",
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        cursor: "auto",
      }}
    >
      {head && (
        <div style={{ fontFamily: getCodeFontFamily(), whiteSpace: "pre-wrap" }}>
          {head}
        </div>
      )}
      {head && (lead || more) && (
        <hr
          style={{
            border: 0,
            borderTop: "1px solid var(--ptw-link)",
            margin: "4px 0",
          }}
        />
      )}
      {lead && (
        <div>
          <CodeText text={lead} />
        </div>
      )}
      {more && expanded && doc && <DocRest md={doc} />}
      {more && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            margin: "4px 0 0",
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--ptw-statusbar-on, inherit)",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          {expanded ? "Less" : "More…"}
        </button>
      )}
    </div>,
    document.body,
  );
}

/** A tactic token with a docstring (tacticCore): the doc card on hover. */
export function DocTokenSpan({
  text,
  color,
  doc,
}: {
  text: string;
  color?: string;
  doc: string;
}) {
  const h = useDocHover();
  return (
    <span
      style={{ color, cursor: "help" }}
      onMouseEnter={(e) => h.arm(e.currentTarget as HTMLElement)}
      onMouseLeave={h.leave}
      onPointerDown={h.press}
    >
      {text}
      {h.anchor && (
        <DocCard anchor={h.anchor} doc={doc} onEnter={h.keep} onLeave={h.leave} />
      )}
    </span>
  );
}
