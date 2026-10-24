// BAKED CODE — the static viewer's stand-in for the infoview's `InteractiveCode`.
//
// A tagged goal or token arrives with every tag's popup already resolved
// (`ProofTreeHarvest.bakePopup`, the questions core's `makePopup` asks, asked at
// harvest time) and interned in the payload's `hovers` table. This draws the
// tagged text, washes the INNERMOST tag under the pointer as the infoview does,
// and after a short dwell shows that tag's popup: `expr : type`, then the
// docstring. Diff tags draw with the infoview's own class names, so
// `taggedCore`'s CSS (inserted/removed washes) applies unchanged.
import { useContext, useState, type ReactNode } from "react";
import type { TaggedText } from "./taggedText";
import { BakedPopups } from "./bakedPopups";
import { DocCard } from "./docTip";
import { useDocHover } from "./docHover";
import { daggerHtml } from "./dagger";
import type { BakedTag } from "./viewerPayload";


const DIFF_CLASS: Record<NonNullable<BakedTag["diffStatus"]>, string> = {
  wasChanged: "inserted-text",
  willChange: "removed-text",
  wasInserted: "inserted-text",
  willInsert: "inserted-text",
  willDelete: "removed-text",
  wasDeleted: "removed-text",
};

function BakedTagSpan({ tag, children }: { tag: BakedTag; children: ReactNode }) {
  const popups = useContext(BakedPopups);
  const [lit, setLit] = useState(false);
  const h = useDocHover();
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
    setLit(false);
    h.leave();
  };
  const head = !popup
    ? ""
    : popup.expr && popup.type
      ? `${popup.expr} : ${popup.type}`
      : (popup.expr ?? popup.type ?? "");
  return (
    <span
      className={cls || undefined}
      style={shows ? { cursor: "default" } : undefined}
      onMouseOver={(e) => {
        // The INNERMOST tag answers: an outer tag sees the event already
        // claimed by the one inside it and lets go. Events from this tag's
        // own card (a portal child) only keep it open.
        const ev = e.nativeEvent as MouseEvent & { ptwBaked?: boolean };
        if (ev.ptwBaked || !shows) {
          if (lit) leave();
          return;
        }
        ev.ptwBaked = true;
        if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) {
          h.keep();
          return;
        }
        if (!lit) setLit(true);
        h.arm(e.currentTarget as HTMLElement);
      }}
      onMouseLeave={leave}
      onPointerDown={h.press}
    >
      {children}
      {h.anchor && popup && (
        <DocCard
          anchor={h.anchor}
          head={head}
          doc={popup.doc}
          onEnter={h.keep}
          onLeave={leave}
        />
      )}
    </span>
  );
}

/** Draw one piece of baked tagged text. */
export function BakedCode({ fmt }: { fmt: TaggedText<BakedTag> }): ReactNode {
  if ("text" in fmt) return daggerHtml(fmt.text);
  if ("append" in fmt)
    return fmt.append.map((t, i) => <BakedCode key={i} fmt={t} />);
  return (
    <BakedTagSpan tag={fmt.tag[0]}>
      <BakedCode fmt={fmt.tag[1]} />
    </BakedTagSpan>
  );
}
