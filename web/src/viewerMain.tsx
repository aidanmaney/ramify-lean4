// The static viewer's entry (viewer.html): see viewer.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Viewer from "./viewer";
import { applyTheme, initialTheme } from "./viewerTheme";

// Before the first render: the view resolves light/dark from these variables
// at mount, so setting them here means its first paint is already right.
applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
);
