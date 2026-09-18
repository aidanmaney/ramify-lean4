import { useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { POPUP_CHROME } from "./theme";
import { TipContext } from "./tipController";

/** Gap between the target and the tip, and the tip's inset from the frame. */
const TIP_GAP = 6;
const TIP_INSET = 4;
export const TIP_MAX_W = 320;

/* THE IN-PAGE TOOLTIP's paint (the controller and the why: tipController.ts).

Rendered once, inside the view's frame (the `position: relative` root), above
every other floater, `pointerEvents: none`. It subscribes to the controller on
its own, so a tip showing re-renders this div and nothing else. Its position is
written straight onto the element in a layout effect — measured off the target
and the tip's own box, never through React state — above the target, below it
where there is no room above, clamped inside the frame. `left`/`top` are never
in the JSX, so a re-render cannot reset them. The chrome is the toast's and the
doc-token popup's: `POPUP_CHROME` + the editor-widget border. */
export function TipLayer() {
  const ctl = useContext(TipContext);
  const tip = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tip) return;
    const root = box.offsetParent as HTMLElement | null;
    if (!root) return;
    const fr = root.getBoundingClientRect();
    const tr = tip.el.getBoundingClientRect();
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    const cx = tr.left + tr.width / 2 - fr.left;
    let left = cx - bw / 2;
    left = Math.max(TIP_INSET, Math.min(left, root.clientWidth - bw - TIP_INSET));
    let top = tr.top - fr.top - TIP_GAP - bh;
    if (top < TIP_INSET) top = tr.bottom - fr.top + TIP_GAP;
    top = Math.max(TIP_INSET, Math.min(top, root.clientHeight - bh - TIP_INSET));
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
    box.style.visibility = "visible";
  }, [tip]);

  // Every way the pointer's world changes under a standing tip: a press
  // (before any click handler runs — capture), a scroll anywhere (scroll does
  // not bubble, but capture sees it), a wheel (the ⌘-scroll zoom), and the
  // window losing focus: once another macOS app is in front the webview gets
  // no pointer events at all (measured live 2026-09-16), so a standing tip
  // would stay frozen on screen until the reader came back.
  useEffect(() => {
    const off = () => ctl.dismiss();
    window.addEventListener("blur", off);
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("scroll", off, true);
    document.addEventListener("wheel", off, { capture: true, passive: true });
    return () => {
      window.removeEventListener("blur", off);
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("scroll", off, true);
      document.removeEventListener("wheel", off, true);
      ctl.dismiss();
    };
  }, [ctl]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      data-ptw-tip=""
      style={{
        position: "absolute",
        visibility: "hidden",
        zIndex: 30,
        pointerEvents: "none",
        boxSizing: "border-box",
        width: "max-content",
        maxWidth: TIP_MAX_W,
        ...POPUP_CHROME,
        padding: "4px 8px",
        border: "1px solid var(--vscode-editorWidget-border, #cbd5e0)",
        color: "var(--vscode-icon-foreground, #2d3748)",
        fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
        fontSize: 11,
        lineHeight: "15px",
        textAlign: "left",
        whiteSpace: "pre-line",
        overflowWrap: "anywhere",
      }}
    >
      {tip.text}
    </div>
  );
}
