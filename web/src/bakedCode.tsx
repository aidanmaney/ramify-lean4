// BAKED CODE — the static viewer's stand-in for the infoview's `InteractiveCode`.
//
// A tagged goal or token arrives with every tag's popup already resolved
// (`ProofTreeHarvest.bakePopup`, the questions core's `makePopup` asks, asked at
// harvest time) and interned in the payload's `hovers` table. This draws the
// tagged text, washes the INNERMOST tag under the pointer as the infoview does,
// and after a short dwell shows that tag's popup: `expr : type`, then the
// docstring. Diff tags draw with the infoview's own class names, so
// `taggedCore`'s CSS (inserted/removed washes) applies unchanged.
import {
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cleanMarkdown } from "./proofToTree";
import type { TaggedText } from "./taggedText";
import { CHROME_TEXT_SM, FLOATER_CHROME, Z, chromeScopeProps } from "./theme";
import { BakedPopups } from "./bakedPopups";
import type { BakedPopup, BakedTag } from "./viewerPayload";


const DIFF_CLASS: Record<NonNullable<BakedTag["diffStatus"]>, string> = {
  wasChanged: "inserted-text",
  willChange: "removed-text",
  wasInserted: "inserted-text",
  willInsert: "inserted-text",
  willDelete: "removed-text",
  wasDeleted: "removed-text",
};

/** How long the pointer rests before a popup opens: the infoview's own hold. */
const DWELL_MS = 150;

interface Open {
  popup: BakedPopup;
  x: number;
  y: number;
}

function BakedTagSpan({ tag, children }: { tag: BakedTag; children: ReactNode }) {
  const popups = useContext(BakedPopups);
  const [lit, setLit] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const popup = popups[tag.h];
  const shows =
    popup !== undefined && !!(popup.expr || popup.type || popup.doc);
  const cls = [
    tag.diffStatus ? DIFF_CLASS[tag.diffStatus] : "",
    lit && shows ? "ptw-baked-lit" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const leave = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setLit(false);
    setOpen(null);
  };
  return (
    <span
      className={cls || undefined}
      style={shows ? { cursor: "default" } : undefined}
      onMouseOver={(e) => {
        // The INNERMOST tag answers: an outer tag sees the event already
        // claimed by the one inside it and lets go.
        const ev = e.nativeEvent as MouseEvent & { ptwBaked?: boolean };
        if (ev.ptwBaked || !shows) {
          if (lit) leave();
          return;
        }
        ev.ptwBaked = true;
        if (lit) return;
        setLit(true);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        timer.current = window.setTimeout(
          () => setOpen({ popup, x: r.left, y: r.bottom + 4 }),
          DWELL_MS,
        );
      }}
      onMouseLeave={leave}
    >
      {children}
      {open && createPortal(<PopupCard {...open} />, document.body)}
    </span>
  );
}

function PopupCard({ popup, x, y }: Open) {
  const head =
    popup.expr && popup.type
      ? `${popup.expr} : ${popup.type}`
      : (popup.expr ?? popup.type ?? "");
  const doc = popup.doc
    ? cleanMarkdown(popup.doc, { breakableCode: true }).trim()
    : "";
  return (
    <div
      {...chromeScopeProps()}
      role="tooltip"
      style={{
        ...FLOATER_CHROME,
        position: "fixed",
        left: Math.max(4, Math.min(x, window.innerWidth - 460)),
        top: y,
        zIndex: Z.tip,
        maxWidth: 440,
        maxHeight: 320,
        overflow: "hidden",
        pointerEvents: "none",
        fontSize: CHROME_TEXT_SM,
        lineHeight: "15px",
        whiteSpace: "pre-wrap",
      }}
    >
      {head && (
        <div style={{ fontFamily: "var(--ptw-code-font, monospace)" }}>{head}</div>
      )}
      {head && doc && (
        <hr
          style={{
            border: 0,
            borderTop: "1px solid var(--ptw-link)",
            margin: "4px 0",
          }}
        />
      )}
      {doc && <div>{doc}</div>}
    </div>
  );
}

/** Draw one piece of baked tagged text. */
export function BakedCode({ fmt }: { fmt: TaggedText<BakedTag> }): ReactNode {
  if ("text" in fmt) return fmt.text;
  if ("append" in fmt)
    return fmt.append.map((t, i) => <BakedCode key={i} fmt={t} />);
  return (
    <BakedTagSpan tag={fmt.tag[0]}>
      <BakedCode fmt={fmt.tag[1]} />
    </BakedTagSpan>
  );
}
