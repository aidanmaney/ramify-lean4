// The static pages' shared hooks (the viewer, `viewer.tsx`, and the
// playground, `playground.tsx`): the page theme and the narrow breakpoint.
import { useEffect, useState } from "react";
import type { ThemeKind } from "./theme";
import { applyTheme, storeTheme, storedTheme, systemTheme } from "./viewerTheme";

/** Under `px` wide (live: follows resizes). */
export function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < px);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < px);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return narrow;
}

/** The page theme: the reader's pick (remembered) or the system's. */
export function useTheme(): [ThemeKind, () => void] {
  const [picked, setPicked] = useState<ThemeKind | null>(storedTheme);
  const [system, setSystem] = useState<ThemeKind>(systemTheme);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const on = () => setSystem(mq!.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq!.removeEventListener("change", on);
  }, []);
  const kind = picked ?? system;
  // Before paint would be nicer, but the view re-resolves on the attribute
  // change (`observeThemeChange`), so an effect is enough.
  useEffect(() => applyTheme(kind), [kind]);
  const toggle = () => {
    const next: ThemeKind = kind === "dark" ? "light" : "dark";
    // Back to following the system when the pick would equal it.
    const stored = next === system ? null : next;
    storeTheme(stored);
    setPicked(stored);
  };
  return [kind, toggle];
}

