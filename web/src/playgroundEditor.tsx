// THE PLAYGROUND'S EDITOR — CodeMirror 6, the source of truth for the proof.
//
// One line of the declaration header (read-only: a change that touches line 0
// is dropped) and the visitor's tactic block below it. Colour is the static
// viewer's lexer (`lexPaint`, the source pane's), unicode is the input
// method's (`\to` → `→` once the abbreviation is closed by a space or a
// bracket), squiggles are `@codemirror/lint` over the replay's notes, and vim
// is `@replit/codemirror-vim` behind a compartment the header's toggle flips.
//
// The page drives it through a handle: `apply` (an LSP-shaped edit — every tree
// gesture is one), `reveal`, `undo`/`redo`. It reports the text and the caret.
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
  tooltips,
} from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { DocEdit } from "./calcEdit";
import type { RawDiagnostic } from "./diagnostics";
import { expandAbbreviations } from "./playgroundAnswer";
import { lexPaint } from "./sourceLex";
import {
  CHROME_FONT,
  CHROME_RADIUS,
  DIM_OPACITY,
  HOVER_BG,
  HOVER_BORDER,
  HOVER_FG,
  POPUP_CHROME,
  TOKEN_COLOR,
  chromeSurface,
} from "./theme";

type Pos = { line: number; character: number };

export interface EditorHandle {
  apply(e: DocEdit, select?: boolean): void;
  reveal(at: { start: Pos; stop: Pos }): void;
  undo(): void;
  redo(): void;
  focus(): void;
  setText(doc: string): void;
}

const offset = (doc: Text, p: Pos) => {
  const line = doc.line(Math.min(p.line + 1, doc.lines));
  return Math.min(line.from + p.character, line.to);
};
const posOf = (doc: Text, off: number): Pos => {
  const line = doc.lineAt(off);
  return { line: line.number - 1, character: off - line.from };
};

/** The lexer's paint as mark decorations (the whole doc: proofs are short). */
const lexColour = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const src = view.state.doc.toString();
      const paint = lexPaint(src);
      const b = new RangeSetBuilder<Decoration>();
      let a = 0;
      for (let k = 1; k <= src.length; k++) {
        if (k === src.length || paint[k] !== paint[a]) {
          const p = paint[a];
          const color = p ? TOKEN_COLOR[p] : undefined;
          if (color) b.add(a, k, Decoration.mark({ attributes: { style: `color: ${color}` } }));
          a = k;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

/** Line 0 is the declaration header: no typing may touch it — its end
 included (a caret parked there after a click on its wrapped tail would
 otherwise append to `:= by`). The page's own edits pass `filter: false`. */
const headerReadOnly = EditorState.changeFilter.of((tr) => {
  const end = tr.startState.doc.line(1).to;
  let ok = true;
  tr.changes.iterChangedRanges((fromA) => {
    if (fromA <= end) ok = false;
  });
  return ok;
});

const CLOSE = /[\s()[\]{},.:;⟩⟨]/;
/** `\to` + a closing character → `→` + that character (the input method's
 eager replacement, on the abbreviation just closed). Typed one character at a
 time the abbreviation is the one before the caret; pasted (or typed in bulk)
 every abbreviation in the text that is followed by a closing character goes,
 and a trailing unfinished one is left for the next keystroke. */
const abbreviations = EditorView.inputHandler.of((view, from, to, text) => {
  const line = view.state.doc.lineAt(from);
  const before = line.text.slice(0, from - line.from);
  const open = before.match(/\\[^\s\\]+$/);
  const lead = open && text.length > 0 && CLOSE.test(text[0]) ? open[0] : "";
  const tailOpen = text.match(/\\[^\s\\]*$/);
  const body = tailOpen ? text.slice(0, tailOpen.index) : text;
  const done = expandAbbreviations(lead + body);
  const out = done + (tailOpen ? tailOpen[0] : "");
  if (out === lead + text) return false;
  const start = from - lead.length;
  view.dispatch({
    changes: { from: start, to, insert: out },
    selection: { anchor: start + out.length },
    userEvent: "input.type",
  });
  return true;
});

/** Enter keeps the line's indentation; after a `· ` (or `case … =>` with
 nothing after it) the new line lines up with the bullet's block. */
const newlineKeepIndent = keymap.of([
  {
    key: "Enter",
    run: (view) => {
      const { state } = view;
      const head = state.selection.main.head;
      const line = state.doc.lineAt(head);
      const lead = line.text.match(/^\s*/)![0];
      const bullet = line.text.match(/^\s*[·.]\s+/);
      const caseOpen = /^\s*case\s.*=>\s*$/.test(line.text);
      const indent = bullet ? " ".repeat(bullet[0].length) : caseOpen ? lead + "  " : lead;
      view.dispatch({
        changes: { from: head, to: state.selection.main.to, insert: "\n" + indent },
        selection: { anchor: head + 1 + indent.length },
        scrollIntoView: true,
        userEvent: "input",
      });
      return true;
    },
  },
]);

/** THE ELECTRIC BULLET. Enter after `· simp` lines the new line up INSIDE
 that bullet (`newlineKeepIndent`), so the next `·` typed there nested under
 the first and Lean answered "No goals to be proved". Typing `·` (directly
 or through `\.`) as the line's first non-blank character re-indents THAT line
 to the column of the nearest preceding bullet at a shallower-or-equal
 indent — the sibling's column. Nothing else is re-indented; Tab undoes it
 for a bullet meant to nest. */
const electricBullet = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.type")) return tr;
  const state = tr.state;
  const line = state.doc.lineAt(state.selection.main.head);
  if (line.number < 2) return tr;
  const m = line.text.match(/^( *)·/);
  if (!m) return tr;
  // the `·` at the line's first non-blank column is what this edit inserted
  const at = line.from + m[1].length;
  let typed = false;
  tr.changes.iterChanges((_fa, _ta, fromB, toB) => {
    if (fromB <= at && at < toB) typed = true;
  });
  if (!typed) return tr;
  const cur = m[1].length;
  let target = -1;
  for (let n = line.number - 1; n >= 2; n--) {
    const b = state.doc.line(n).text.match(/^( *)·/);
    if (b && b[1].length <= cur) {
      target = b[1].length;
      break;
    }
  }
  if (target < 0 || target === cur) return tr;
  return [
    tr,
    {
      changes: { from: line.from, to: line.from + cur, insert: " ".repeat(target) },
      sequential: true,
      userEvent: "input.type",
    },
  ];
});

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "var(--vscode-editor-background)",
    color: "var(--vscode-editor-foreground)",
  },
  ".cm-scroller": { fontFamily: "var(--vscode-editor-font-family)", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--vscode-editorCursor-foreground, currentColor)" },
  ".cm-gutters": {
    backgroundColor: "var(--vscode-editor-background)",
    color: "var(--vscode-editorLineNumber-foreground, currentColor)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--ptw-chrome-btn, rgba(127,127,127,0.08))" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--vscode-editor-foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-line:first-child": { opacity: 0.8 },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--vscode-editor-selectionBackground, rgba(80,130,220,0.35)) !important",
  },
  ".cm-lintRange-hint": { opacity: 0.5, backgroundImage: "none" },
  // drawSelection paints its own caret (black unless the theme is flagged dark):
  // the editor's cursor colour, so insert mode's bar shows on any theme
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground, currentColor))",
    borderLeftWidth: "2px",
  },
  // THE HOVERS (a squiggle's and the gutter mark's): the editor's hover
  // widget, `--ptw-hover-*`, over the opaque background (a theme's hover
  // colour may carry alpha). `!important` because @codemirror/view's base
  // theme scopes its light `#f5f5f5` one class deeper than this theme.
  ".cm-tooltip, .cm-tooltip.cm-tooltip-lint, .cm-tooltip.cm-tooltip-hover": {
    background: `${chromeSurface(HOVER_BG)} !important`,
    color: `${HOVER_FG} !important`,
    border: `1px solid ${HOVER_BORDER} !important`,
    borderRadius: `${CHROME_RADIUS}px`,
    boxShadow: POPUP_CHROME.boxShadow,
  },
  ".cm-tooltip .cm-diagnostic": {
    color: HOVER_FG,
    fontFamily: "var(--vscode-editor-font-family)",
    whiteSpace: "pre-wrap",
  },
  ".cm-tooltip .cm-diagnosticSource": { fontFamily: CHROME_FONT, opacity: DIM_OPACITY },
  ".cm-diagnostic-error": { borderLeftColor: "var(--ptw-danger)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--ptw-warn)" },
  ".cm-diagnostic-info, .cm-diagnostic-hint": { borderLeftColor: "var(--ptw-info)" },
  ".cm-fat-cursor": { background: "var(--vscode-editorCursor-foreground, #aaa) !important" },
});

/** Vim mode, loaded on first use: it is ~150 KB gzipped of a page most readers
 never switch it on in (publish.mjs splits it into its own chunk). */
let vimPromise: Promise<() => Extension> | null = null;
const loadVim = () => (vimPromise ??= import("@replit/codemirror-vim").then((m) => m.vim));

const SEVERITY: Record<number, Diagnostic["severity"]> = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

export function PlaygroundEditor({
  initial,
  vimOn,
  diagnostics,
  onText,
  onCaret,
  ref,
}: {
  initial: string;
  vimOn: boolean;
  diagnostics: RawDiagnostic[];
  onText: (doc: string) => void;
  onCaret: (p: Pos) => void;
  ref?: Ref<EditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const vimSlot = useRef(new Compartment());
  const cbs = useRef({ onText, onCaret });
  useEffect(() => {
    cbs.current = { onText, onCaret };
  });

  // the view lives as long as the component; `initial` seeds it once
  const seed = useRef(initial);
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: seed.current,
        selection: EditorSelection.cursor(seed.current.length),
        extensions: [
          vimSlot.current.of([]),
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          lintGutter(),
          // tooltips on the page's THEMED root (`[data-ptw-theme]`, unclipped):
          // inside the editor pane a lint tooltip on an early line opened above
          // it and was cut off by the pane's top edge; out here CodeMirror flips
          // it below and keeps it in the window. Not <body>: the `--ptw-*`
          // tokens its colours read are defined on the themed root only.
          tooltips({ parent: host.current!.closest<HTMLElement>("[data-ptw-theme]") ?? document.body }),
          newlineKeepIndent,
          electricBullet,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          headerReadOnly,
          abbreviations,
          lexColour,
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cbs.current.onText(u.state.doc.toString());
            if (u.docChanged || u.selectionSet)
              cbs.current.onCaret(posOf(u.state.doc, u.state.selection.main.head));
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (!vimOn) {
      view.current?.dispatch({ effects: vimSlot.current.reconfigure([]) });
      return;
    }
    let live = true;
    void loadVim().then((vim) => {
      if (live) view.current?.dispatch({ effects: vimSlot.current.reconfigure(vim()) });
    });
    return () => {
      live = false;
    };
  }, [vimOn]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const doc = v.state.doc;
    const ds: Diagnostic[] = diagnostics.map((d) => {
      const from = offset(doc, d.range.start);
      return {
        from,
        to: Math.max(from, offset(doc, d.range.stop)),
        severity: SEVERITY[d.severity ?? 1] ?? "error",
        message: d.message,
      };
    });
    v.dispatch(setDiagnostics(v.state, ds));
  }, [diagnostics]);

  useImperativeHandle(
    ref,
    () => ({
      apply(e, select = true) {
        const v = view.current;
        if (!v) return;
        const doc = v.state.doc;
        let from = offset(doc, e.range.start);
        let to = offset(doc, e.range.end);
        // a whole-line delete of the LAST line ends past the document: take
        // to its end, and the newline before the line with it
        if (e.range.end.line >= doc.lines) {
          to = doc.length;
          if (e.newText === "" && e.range.start.character === 0 && from > 0) from -= 1;
        }
        v.dispatch({
          changes: { from, to, insert: e.newText },
          selection: select ? { anchor: from + e.newText.length } : undefined,
          scrollIntoView: true,
          userEvent: "input",
          // the page's own edit (an anchor may start at the header's end)
          filter: false,
        });
      },
      reveal(at) {
        const v = view.current;
        if (!v) return;
        const doc = v.state.doc;
        v.dispatch({
          selection: { anchor: offset(doc, at.start), head: offset(doc, at.stop) },
          scrollIntoView: true,
        });
        v.focus();
      },
      undo() {
        if (view.current) undo(view.current);
      },
      redo() {
        if (view.current) redo(view.current);
      },
      focus() {
        view.current?.focus();
      },
      setText(doc) {
        const v = view.current;
        if (!v) return;
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: doc },
          selection: { anchor: doc.length },
          // a reset is not an undo step the header filter should refuse
          filter: false,
        });
      },
    }),
    [],
  );

  return <div ref={host} className="ptw-pg-editor" />;
}
