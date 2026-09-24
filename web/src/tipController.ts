import { createContext, useContext } from "react";
import { plainTicks } from "./ticks";

/* THE IN-PAGE TOOLTIP — the controller half (the paint is `TipLayer`, tip.tsx).

WHY NOT `title`. Every chrome control carried a native `title` (or an SVG
`<title>`), and in the VS Code infoview those FAIL two ways, both measured
2026-09-16: while VS Code is not the active macOS app NO native tooltip shows
at all, though pointer events still reach the webview (the hover bar appears);
and even with it active they are flaky — a control whose own hover re-renders
the tree (the trash can's delete preview) never showed one, and the eye failed
on a first hover and worked on a retry. So the status bar, its panels, the rail,
the hover bar and the pills show THIS instead, and carry the same text as an
`aria-label` so the accessible name is unchanged. Node BOX titles stay native.

The TEXT is read off the target's own `aria-label` when the tip shows (and
re-read while it stands), so a label that changes under the pointer — `⁇`
going busy, `Marks: 2 of 5` — is what the tip says, with no second copy.

This is a plain object held OUTSIDE React state: showing a tip re-renders the
one small layer that subscribes to it, never the view, so no tip can relayout
or move anything. Timers are `setTimeout` (the hidden preview pane runs no rAF).

Timing is the native "tooltip mode": the first tip waits `TIP_DWELL_MS`; once
one has shown, the next target shows at once, until the pointer has been off
every target for `TIP_COOL_MS`. The dwell is the platform's own: macOS shows a
native tooltip after about a second of rest, and 450 ms read as jumpy beside
every other tooltip on the desktop (user report, 2026-09-16). */
export const TIP_DWELL_MS = 1000;
export const TIP_COOL_MS = 600;
/** How often a standing tip checks its target is still mounted (React sends
 no `pointerleave` for an element it removes) and re-reads its text. */
const TIP_POLL_MS = 200;

export interface TipShown {
  el: Element;
  text: string;
}

export class TipController {
  private shownTip: TipShown | null = null;
  private listeners = new Set<() => void>();
  private pending: Element | null = null;
  // Clicked or dismissed under the pointer: stays quiet until the pointer
  // leaves it, as a native tooltip does after a click.
  private suppressed: Element | null = null;
  private warm = false;
  private dwellT: ReturnType<typeof setTimeout> | undefined;
  private coolT: ReturnType<typeof setTimeout> | undefined;
  private pollT: ReturnType<typeof setTimeout> | undefined;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.shownTip;
  shown = () => this.shownTip !== null;

  private set(next: TipShown | null) {
    if (next === this.shownTip) return;
    this.shownTip = next;
    clearTimeout(this.pollT);
    if (next) this.pollT = setTimeout(this.poll, TIP_POLL_MS);
    for (const fn of this.listeners) fn();
  }

  private poll = () => {
    const cur = this.shownTip;
    if (!cur) return;
    if (!cur.el.isConnected) {
      this.set(null);
      this.cool();
      return;
    }
    const text = cur.el.getAttribute("aria-label") ?? "";
    if (!text) {
      this.set(null);
      return;
    }
    if (text !== cur.text) this.set({ el: cur.el, text });
    else this.pollT = setTimeout(this.poll, TIP_POLL_MS);
  };

  private show(el: Element) {
    const text = el.getAttribute("aria-label") ?? "";
    if (!text || !el.isConnected) return;
    this.warm = true;
    this.set({ el, text });
  }

  private cool() {
    clearTimeout(this.coolT);
    if (this.warm)
      this.coolT = setTimeout(() => {
        this.warm = false;
      }, TIP_COOL_MS);
  }

  enter = (el: Element) => {
    if (el === this.suppressed) return;
    clearTimeout(this.coolT);
    clearTimeout(this.dwellT);
    this.pending = el;
    if (this.warm) {
      this.show(el);
      return;
    }
    this.dwellT = setTimeout(() => {
      if (this.pending === el) this.show(el);
    }, TIP_DWELL_MS);
  };

  leave = (el: Element) => {
    if (this.suppressed === el) this.suppressed = null;
    if (this.pending === el) {
      this.pending = null;
      clearTimeout(this.dwellT);
    }
    if (this.shownTip?.el === el) this.set(null);
    this.cool();
  };

  /** Pointerdown, Esc, scroll, zoom: the tip goes, tooltip mode ends, and the
   target under the pointer stays quiet until it is left. */
  dismiss = () => {
    clearTimeout(this.dwellT);
    clearTimeout(this.coolT);
    this.warm = false;
    this.suppressed = this.pending ?? this.shownTip?.el ?? null;
    this.set(null);
  };
}

const NOOP = new TipController();
export const TipContext = createContext<TipController>(NOOP);

/** The props a tip target spreads: the text as its `aria-label` (which is
 also where the tip reads it) and the enter/leave pair. POINTER events, never
 mouse ones: React drops `onMouseEnter` on a disabled button, and a disabled
 row's tip is the one that says why it is disabled. */
export function useTip() {
  const ctl = useContext(TipContext);
  return {
    ctl,
    props: (text: string | undefined) => ({
      // Ticks stripped: a tip cannot draw a code span (ticks.ts).
      "aria-label": text ? plainTicks(text) : undefined,
      onPointerEnter: (e: { currentTarget: Element }) => ctl.enter(e.currentTarget),
      onPointerLeave: (e: { currentTarget: Element }) => ctl.leave(e.currentTarget),
    }),
  };
}
