// The static viewer's theme. In VS Code the host sets the `--vscode-*`
// variables the view's palette reads (theme.ts); a plain page has none, so the
// viewer sets the few it reads on `:root`, one light set and one dark, and the
// view's own palette and `resolveThemeKind` work unchanged from them.
//
// The choice follows `prefers-color-scheme` until the reader picks one with
// the toggle; the pick is remembered in localStorage (wrapped: storage can be
// absent or throw, and the page must draw the same without it).
//
// The vars are written to `document.documentElement.style` on purpose: the
// view watches that attribute (`observeThemeChange`) and re-resolves its
// palette when it changes, exactly as it does when VS Code switches theme.
import type { ThemeKind } from "./theme";

const HOST_VARS: Record<ThemeKind, Record<string, string>> = {
  light: {
    "--vscode-editor-background": "#ffffff",
    "--vscode-editor-foreground": "#1f2328",
    "--vscode-foreground": "#1f2328",
    "--vscode-editorWidget-background": "#f6f8fa",
    "--vscode-editorWidget-border": "#d0d7de",
    "--vscode-diffEditor-insertedTextBackground": "rgba(46, 160, 67, 0.20)",
    "--vscode-diffEditor-removedTextBackground": "rgba(248, 81, 73, 0.20)",
    "--vscode-toolbar-hoverBackground": "rgba(31, 35, 40, 0.07)",
    "--vscode-list-activeSelectionBackground": "#ddf4ff",
    "--vscode-input-background": "#ffffff",
    "--vscode-input-foreground": "#1f2328",
    "--vscode-icon-foreground": "#57606a",
    "--vscode-focusBorder": "#0969da",
    "--vscode-errorForeground": "#cf222e",
    "--vscode-editorWarning-foreground": "#9a6700",
    "--vscode-editorBracketHighlight-foreground1": "#0431fa",
    "--vscode-editorBracketHighlight-foreground2": "#319331",
    "--vscode-editorBracketHighlight-foreground3": "#7b3814",
    "--vscode-editorBracketHighlight-foreground4": "#0431fa",
    "--vscode-editorBracketHighlight-foreground5": "#319331",
    "--vscode-editorBracketHighlight-foreground6": "#7b3814",
  },
  dark: {
    "--vscode-editor-background": "#1b1d22",
    "--vscode-editor-foreground": "#d5d8dd",
    "--vscode-foreground": "#d5d8dd",
    "--vscode-editorWidget-background": "#24272e",
    "--vscode-editorWidget-border": "#3b404a",
    "--vscode-diffEditor-insertedTextBackground": "rgba(63, 185, 80, 0.22)",
    "--vscode-diffEditor-removedTextBackground": "rgba(248, 81, 73, 0.22)",
    "--vscode-toolbar-hoverBackground": "rgba(213, 216, 221, 0.09)",
    "--vscode-list-activeSelectionBackground": "#2c3a4f",
    "--vscode-input-background": "#24272e",
    "--vscode-input-foreground": "#d5d8dd",
    "--vscode-icon-foreground": "#aab1bb",
    "--vscode-focusBorder": "#4c8dda",
    "--vscode-errorForeground": "#f47067",
    "--vscode-editorWarning-foreground": "#d9b53f",
    "--vscode-editorBracketHighlight-foreground1": "#ffd700",
    "--vscode-editorBracketHighlight-foreground2": "#da70d6",
    "--vscode-editorBracketHighlight-foreground3": "#179fff",
    "--vscode-editorBracketHighlight-foreground4": "#ffd700",
    "--vscode-editorBracketHighlight-foreground5": "#da70d6",
    "--vscode-editorBracketHighlight-foreground6": "#179fff",
  },
};

const SHARED_VARS: Record<string, string> = {
  "--vscode-font-family":
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  "--vscode-editor-font-family":
    '"JuliaMono", "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

/** A fixed, Lean-flavoured token palette per theme, passed to the view as
 `tokenColors` (its `TOKEN_VARS`) and set on the page for the source pane:
 keywords violet, constants blue, bound variables teal, literals warm. Every
 colour clears 4.5:1 on its theme's background. */
export const TOKEN_PALETTE: Record<ThemeKind, Record<string, string>> = {
  light: {
    keyword: "#7a3db8",
    function: "#1f5fae",
    variable: "#0b6b70",
    property: "#3b5a9a",
    number: "#9a5200",
    string: "#a3302a",
    comment: "#3a7d2c",
    type: "#1d6a86",
    leanSorryLike: "#c0282d",
  },
  dark: {
    keyword: "#c9a0f2",
    function: "#86b4f5",
    variable: "#76cfd1",
    property: "#a9bff0",
    number: "#efb67c",
    string: "#e9a28b",
    comment: "#93b57f",
    type: "#7cc6df",
    leanSorryLike: "#f58a7d",
  },
};

const STORE_KEY = "ramify-viewer-theme";

/** The reader's remembered pick, if any. */
export function storedTheme(): ThemeKind | null {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function storeTheme(kind: ThemeKind | null) {
  try {
    if (kind) window.localStorage.setItem(STORE_KEY, kind);
    else window.localStorage.removeItem(STORE_KEY);
  } catch {
    // No storage: the pick lasts for this page only.
  }
}

/** What the page starts in: the reader's pick, else the system's. */
export function initialTheme(): ThemeKind {
  return storedTheme() ?? systemTheme();
}

export function systemTheme(): ThemeKind {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/** Write one theme's variables onto `:root` (and the token palette for the
 source pane, which sits outside the view's own scope). */
export function applyTheme(kind: ThemeKind) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries({ ...SHARED_VARS, ...HOST_VARS[kind] }))
    root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(TOKEN_PALETTE[kind]))
    root.style.setProperty(`--ptw-tok-${k}`, v);
  root.style.colorScheme = kind;
  root.dataset.theme = kind;
}
