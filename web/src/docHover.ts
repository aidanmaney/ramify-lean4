// The doc card's hover logic (docTip.tsx), shared by every span that carries
// a docstring: a dwell to open, a grace to close, a press holds it shut.
import { useEffect, useRef, useState } from "react";

/** How long the pointer rests before a card opens: the infoview's own hold. */
export const DOC_DWELL_MS = 150;
/** How long a card outlives the pointer leaving its anchor — time to cross
 the gap into the card. */
const DOC_GRACE_MS = 200;

// Only one card is ever up: opening one closes whichever was (a module slot,
// written and read in handlers alone; `who` is the owning span's token).
let openCard: { who: object; close: () => void } | null = null;

/** The hover logic every doc-carrying span shares: a dwell to open, a grace
 to close (cancelled by entering the card), any pointer press closes and
 holds it shut until the pointer leaves (so a right-click never opens one). */
export function useDocHover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const openT = useRef<number | null>(null);
  const closeT = useRef<number | null>(null);
  const held = useRef(false);
  // This span's identity for the module slot (state, so render reads no ref).
  const [who] = useState(() => ({}));
  useEffect(
    () => () => {
      if (openT.current !== null) window.clearTimeout(openT.current);
      if (closeT.current !== null) window.clearTimeout(closeT.current);
    },
    [],
  );
  const clear = () => {
    if (openT.current !== null) window.clearTimeout(openT.current);
    if (closeT.current !== null) window.clearTimeout(closeT.current);
    openT.current = closeT.current = null;
  };
  const closeNow = () => {
    clear();
    setAnchor(null);
    if (openCard?.who === who) openCard = null;
  };
  return {
    anchor,
    /** The pointer arrived on the anchor `el`: open after the dwell. */
    arm(el: HTMLElement) {
      if (closeT.current !== null) window.clearTimeout(closeT.current);
      closeT.current = null;
      if (anchor || held.current || openT.current !== null) return;
      openT.current = window.setTimeout(() => {
        openT.current = null;
        if (openCard && openCard.who !== who) openCard.close();
        openCard = { who, close: closeNow };
        setAnchor(el.getBoundingClientRect());
      }, DOC_DWELL_MS);
    },
    /** The pointer is on the card (or back on the anchor): stay. */
    keep() {
      if (closeT.current !== null) window.clearTimeout(closeT.current);
      closeT.current = null;
    },
    /** The pointer left: cancel a pending open, close after the grace. */
    leave() {
      held.current = false;
      if (openT.current !== null) window.clearTimeout(openT.current);
      openT.current = null;
      if (closeT.current !== null) window.clearTimeout(closeT.current);
      closeT.current = window.setTimeout(closeNow, DOC_GRACE_MS);
    },
    /** A press on the anchor (any button): close, and stay shut until the
     pointer leaves. */
    press() {
      held.current = true;
      closeNow();
    },
    close: closeNow,
  };
}

