// Keyboard behaviour shared by the status bar's panels and the help panel.
import { useLayoutEffect, type KeyboardEvent, type RefObject } from "react";

/* HOW THE LAST INPUT ARRIVED — the `:focus-visible` heuristic, held where a
panel can ask it. A panel opened from the keyboard moves focus onto its rows so
the arrows work at once; one opened with the mouse leaves focus exactly where
the click put it. The question is answered by the last INPUT event (a key, or
a pointer press), not by the click's own `detail`, so it holds for the `?` key
and for F1 too and cannot go stale across a close. */
let lastInputKeyboard = true;
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      lastInputKeyboard = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      lastInputKeyboard = false;
    },
    true,
  );
}
export const openedByKeyboard = () => lastInputKeyboard;

/** Focus a floater's first row — the checked one where a row says it is — for
 `useRestoreFocus`'s `focusIn`. Module-level, so its identity is stable. */
export function focusFirstRow(box: HTMLElement) {
  const rows = Array.from(
    box.querySelectorAll<HTMLElement>(
      "[role^=menuitem]:not(:disabled):not([data-ptw-slider])",
    ),
  );
  const first =
    rows.find((r) => r.getAttribute("aria-checked") === "true") ?? rows[0];
  first?.focus({ preventScroll: true });
}

/** Focus the floater itself, for `useRestoreFocus`'s `focusIn`. */
export function focusBox(box: HTMLElement) {
  box.focus({ preventScroll: true });
}

/** Focus on a floater's arrival and back again on its leaving. Opened from the
 keyboard, focus moves in (`focusIn`) so its rows or text can be reached at
 once; opened with the mouse, nothing moves. Closing hands focus back to
 whatever had it, if it was inside the floater. */
export function useRestoreFocus(
  ref: RefObject<HTMLElement | null>,
  focusIn: (box: HTMLElement) => void,
) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement;
    if (openedByKeyboard()) focusIn(box);
    return () => {
      const a = document.activeElement;
      if (opener instanceof HTMLElement && opener.isConnected && a && box.contains(a))
        opener.focus({ preventScroll: true });
    };
  }, [ref, focusIn]);
}

/** The rows a panel's arrow keys move between: its menu items and its range
 slider (Up/Down leave the slider for the next row; Left/Right stay its own). */
const PANEL_STOPS =
  "[role^=menuitem]:not(:disabled):not([data-ptw-slider]), input[type=range]";

/** Keyboard on a PANEL of rows — the pattern `NodeMenu` uses: Up/Down/Home/End
 walk the rows, Tab closes (focus returns to the trigger through `BarPanel`'s
 own cleanup). Only keys that landed on a row are taken, so the slider keeps
 its Left/Right/Home/End. */
export function panelKeys(
  e: KeyboardEvent<HTMLElement>,
  onClose: () => void,
) {
  if (e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    onClose();
    return;
  }
  const stops = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>(PANEL_STOPS),
  );
  const at = stops.indexOf(e.target as HTMLElement);
  if (at < 0 || stops.length === 0) return;
  const onSlider = (e.target as HTMLElement).tagName === "INPUT";
  // A ROW OF SHORT ACTIONS (`BarActionRow`): ←/→ step between its buttons, no
  // wrap; ↑/↓ still visit them in turn, as they do every other row.
  const group = (e.target as HTMLElement).closest("[data-ptw-rowgroup]");
  if (group && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    const mates = stops.filter((s) => group.contains(s));
    const k = mates.indexOf(e.target as HTMLElement) + (e.key === "ArrowRight" ? 1 : -1);
    e.preventDefault();
    e.stopPropagation();
    if (k >= 0 && k < mates.length) mates[k].focus({ preventScroll: true });
    return;
  }
  let to: number;
  if (e.key === "ArrowDown") to = (at + 1) % stops.length;
  else if (e.key === "ArrowUp") to = (at - 1 + stops.length) % stops.length;
  else if (e.key === "Home" && !onSlider) to = 0;
  else if (e.key === "End" && !onSlider) to = stops.length - 1;
  else return;
  e.preventDefault();
  e.stopPropagation();
  stops[to].focus({ preventScroll: true });
}

