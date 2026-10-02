// The static viewer's entry (viewer.html): see viewer.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Viewer from "./viewer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Viewer />
  </StrictMode>,
);
