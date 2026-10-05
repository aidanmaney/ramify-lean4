// The baked playground's entry (playground.html): see playground.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Playground from "./playground";
import { applyTheme, initialTheme } from "./viewerTheme";

// Before the first render, as the viewer does: the view resolves light/dark
// from these variables at mount.
applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
