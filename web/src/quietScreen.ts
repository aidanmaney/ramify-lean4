// A QUIET SCREEN before the page thread is held. Live Lean on the page's main
// thread (Safari, playgroundLive.ts) freezes the page for each answer; a freeze
// that lands mid-animation, mid-scroll or under the pointer reads as a stutter,
// one on a still screen reads as thinking. So each blocking call first waits
// until (a) no finite animation is running (CSS transitions/animations, WAAPI —
// an infinite spinner is not motion that ends, so it does not count), (b) no
// pointer, key, wheel or scroll event for QUIET_MS (the view's eased scrolls are
// JS-driven and show up here as scroll events), (c) nothing registered with
// `holdWhile` is busy — and then one frame has PAINTED (rAF, then a timeout).
// setTimeout polling, never requestIdleCallback (behind a flag in Safari). Capped
// at CAP_MS: a page that never goes quiet still gets its answer.
const QUIET_MS = 150;
const POLL_MS = 25;
const CAP_MS = 1500;
/** rAF does not fire in a hidden tab: the frame wait gives up after this. */
const FRAME_FALLBACK_MS = 100;

let lastInput = -Infinity;

let listening = false;
const holds = new Set<() => boolean>();

/** Start watching input (idempotent); `quietScreen` calls it too, but a host
 that will block should call it early, so input before its first wait counts. */
export function watchInput(): void {
  if (listening) return;
  listening = true;
  const mark = () => {
    lastInput = performance.now();
  };
  // capture: scroll does not bubble, and an element's scroll reaches the window's capture
  for (const t of ["pointerdown", "pointermove", "keydown", "wheel", "scroll"])
    window.addEventListener(t, mark, { capture: true, passive: true });
}

/** Something else that should finish painting first (e.g. a status label still
 queued for display). Asked only while a blocking call waits, so a hold may also
 hurry its display along (skip pacing) — the thread is about to stop anyway.
 Returns the unregister. */
export function holdWhile(busy: () => boolean): () => void {
  holds.add(busy);
  return () => holds.delete(busy);
}

function moving(now: number): boolean {
  if (now - lastInput < QUIET_MS) return true;
  for (const h of holds) if (h()) return true;
  try {
    for (const a of document.getAnimations())
      if (a.playState === "running" && a.effect?.getTiming().iterations !== Infinity) return true;
  } catch {
    /* no getAnimations: nothing to wait on */
  }
  return false;
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

function paintedFrame(): Promise<void> {
  return new Promise((ok) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(ok, 0); // after the rAF callback the frame paints; this runs after it
    };
    requestAnimationFrame(go);
    setTimeout(go, FRAME_FALLBACK_MS);
  });
}

/** Resolves once the screen is quiet and painted; the ms it waited. */
export async function quietScreen(): Promise<number> {
  watchInput();
  const t0 = performance.now();
  while (performance.now() - t0 < CAP_MS && moving(performance.now())) await sleep(POLL_MS);
  await paintedFrame();
  return performance.now() - t0;
}
