// The IN-PLACE EDITOR: the overlay a double-click opens on a tactic, a
// comment, a chip's insertion or a calc step — textarea, completion list,
// unicode abbreviations, the mark tab drawn above it. Its state lives in the
// view (ProofTreeView.tsx owns `editing` and every handler); this is its
// paint. Split out of ProofTreeView.tsx.
import {
  LINE_H,
  NODE_FONT_PX,
  NODE_PAD,
  NODE_PAD_Y,
  COMMENT_FONT_PX,
  COMMENT_LINE_H,
  bandTopH,
  commentStripTop,
  getCodeFontFamily,
  measureText,
} from "./layout";
import { AbbrevSession, underlineRuns, type AbbrevSpan } from "./abbreviation";
import type { CompletionItem } from "./completion";
import type { Caps } from "./gestures";
import {
  PROSE_FILL,
  EDIT_BG,
  EDIT_TEXT,
  NODE_STYLES,
  POPUP_CHROME,
  CHROME_RADIUS,
  DIM_OPACITY,
  FOCUS_INK,
} from "./theme";
import {
  EDIT_STROKE,
  EDIT_CELL,
  EDIT_SPILL_CELL,
  nodeBoxFill,
  nodeRx,
  editOverlayLayer,
} from "./scrollHelpers";
import { TourTab } from "./topChrome";
import type { ProofTreeViewProps } from "./proofTreeViewProps";
import { COMPLETION_MAX_W, COMPLETION_MAX_H } from "./viewConstants";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { AddSpec, PlacedNode } from "./types";
import type { ProofStepPosition } from "./paperproof";

/** What the in-place editor is editing (the view's `editing` state). */
export interface Editing {
  id: string;
  pos: ProofStepPosition;
  original: string;
  value: string;

  add?: AddSpec;

  calcStage?: {
    stage: "lhs" | "rhs";
    lhs: ProofStepPosition;
    rhs: ProofStepPosition;

    stub: ProofStepPosition | null;

    anchor: { line: number; character: number };

    closes: boolean;
  };

  fill?: boolean;

  tokPos?: ProofStepPosition;

  comment?: boolean;

  commentIndent?: number;

  cfIndent?: number;
}

export function NodeEditor({
  editing,
  placed,
  tourTabs,
  tabStops,
  currentStopId,
  caps,
  codeFont,
  renderTaggedTactic,
  completion,
  setCompletion,
  refreshCompletion,
  acceptCompletion,
  abbrevSess,
  abbrevSpans,
  putSpans,
  syncAbbrev,
  editKey,
  editingRef,
  setEditing,
  commitEdit,
  nativeClip: nativeClipRef,
  clipboardFallback,
}: {
  editing: Editing;
  placed: ReadonlyMap<string, PlacedNode>;
  tourTabs: ReadonlyMap<string, { n: number; who: "author" | "mine" }>;
  tabStops: readonly unknown[];
  currentStopId: string | null;
  caps: Caps;
  codeFont: string;
  renderTaggedTactic: ProofTreeViewProps["renderTaggedTactic"];
  completion: { items: CompletionItem[]; index: number } | null;
  setCompletion: Dispatch<
    SetStateAction<{ items: CompletionItem[]; index: number } | null>
  >;
  refreshCompletion: (nodeId: string, value: string, caret: number) => void;
  acceptCompletion: (
    cur: Editing,
    item: CompletionItem,
    ta: HTMLTextAreaElement | null,
  ) => void;
  abbrevSess: { id: string; session: AbbrevSession } | null;
  abbrevSpans: AbbrevSpan[];
  putSpans: (next: AbbrevSpan[]) => void;
  syncAbbrev: (id: string, value: string, caret: number) => void;
  editKey: (e: Editing | null) => string | null;
  editingRef: RefObject<Editing | null>;
  setEditing: Dispatch<SetStateAction<Editing | null>>;
  commitEdit: () => void;
  nativeClip: RefObject<boolean>;
  clipboardFallback: (
    key: "c" | "x" | "v",
    ta: HTMLTextAreaElement,
    cur: Editing,
  ) => Promise<void>;
}) {
  const en = placed.get(editing.id);
  if (!en) return null;
  const { w, h } = en.data;
  const editTab = tourTabs.get(editing.id);

  const topH = bandTopH(en.data);
  const boxTop = (topH - h) / 2;

  const proseEdit = !!editing.comment && !!en.data.proseLabel;

  const overlayY = proseEdit
    ? boxTop
    : editing.comment
      ? commentStripTop(en.data) - NODE_PAD_Y
      : editing.add || editing.calcStage
        ? boxTop + h + 4
        : boxTop;
  const valueLines = editing.value.split("\n");

  // A REPLACE STANDS IN FOR THE BOX, so at edit start — where
  // the draft IS the label — its rect must BE the box's rect,
  // and that is an arithmetic identity, not a tolerance: the
  // textarea's border + padding is exactly the box's own text
  // inset (2 + 10 = NODE_PAD across, 2 + 3 = NODE_PAD_Y down),
  // so `measureText(draft) + 2 * NODE_PAD` is `sizeOf`'s own
  // width rule and comes out equal. What broke it was a floor
  // and a slack the box knows nothing about: a 320px minimum and
  // a spare 12px, which on a narrow tactic (`rw [ih]`, measured
  // at 74.6px) opened a 320px editor — the reported "smaller but
  // wider". Both belong to the overlays that stand in for NO
  // box: the (+) add, the calc stage, and a comment STRIP, whose
  // text is not the node's.
  //
  // In NARRATION mode the prose IS the box — drawn at the node's
  // own metrics (NODE_FONT_PX italic, LINE_H) by proseLabelSize
  // — so a comment edit there stands in for the box exactly as a
  // tactic replace does: no floor, no slack, the box's metrics.
  // Applying the strip's (COMMENT_FONT_PX 11, COMMENT_LINE_H 18)
  // there was the reported "smaller text in a wider box".
  const standsInForBox =
    !editing.add && !editing.calcStage && (!editing.comment || proseEdit);
  const editFontPx =
    editing.comment && !proseEdit ? COMMENT_FONT_PX : NODE_FONT_PX;
  const editLineH = editing.comment && !proseEdit ? COMMENT_LINE_H : LINE_H;
  // The (+) add and the calc stage hang under their GOAL, so
  // they open at the goal's width (w) and grow with the draft;
  // the 320 floor ran a field under a short goal off the pane's
  // edge (2026-10-25). A comment strip keeps the 320.
  const fw = Math.max(
    w,
    standsInForBox || editing.add || editing.calcStage ? 0 : 320,
    ...valueLines.map(
      (l) =>
        measureText(l, editFontPx, !!editing.comment) +
        2 * NODE_PAD +
        (standsInForBox ? 0 : 12),
    ),
  );

  const openLines =
    editing.add || editing.calcStage
      ? 1
      : editing.comment && !proseEdit
        ? editing.original.split("\n").length
        : valueLines.length;

  // Height follows the DRAFT's line count and never falls below
  // the box's own: at edit start the draft is the original, so
  // the two agree, and a wrapped label whose source is one line
  // keeps the box's height rather than drawing a half-height
  // editor inside the box it replaced. Shift+Enter grows it.
  const fh =
    editing.add || editing.calcStage
      ? openLines * LINE_H + 2 * NODE_PAD_Y
      : editing.comment && !proseEdit
        ? Math.max(1, openLines) * COMMENT_LINE_H + 2 * NODE_PAD_Y
        : Math.max(h, openLines * LINE_H + 2 * NODE_PAD_Y);

  // The overlay's border COINCIDES WITH THE BOX'S STROKE — the
  // foreignObject is the rect grown by EDIT_STROKE/2 on every
  // side, so the editor's 2px border lands exactly on the drawn
  // outline of the accented box (a stroke is centred on the edge,
  // so its outer edge is at rect ± 1). Placed on the rect itself
  // the border sat entirely INSIDE it and the outline stepped
  // inward by 1px per side — at the reader's 2-2.5× tree zoom,
  // ~10 device px, reported as the box getting smaller. The state
  // is still said by the border's COLOUR (accent for a tactic,
  // prose ink for a comment) rather than by a rectangle sitting
  // inside another one. Width is the exception: it grows with the
  // draft. The radius follows the outer curve of that stroke.
  const editRx = nodeRx(en.data.type);
  const editOuterRx = editRx + EDIT_STROKE / 2;

  // An overlay standing in for the box wears the BOX'S fill: in
  // VS Code the editor's input background is visibly darker than
  // a tactic box, so EDIT_BG made the box change colour as it
  // "shrank". Overlays standing in for NO box (the (+) add, the
  // calc stage, a comment STRIP) keep the input background.
  const editBg = standsInForBox ? nodeBoxFill(en.data) : EDIT_BG;

  const mirrorPos = editing.tokPos ?? en.data.position;

  const editHighlight =
    !editing.add &&
    !editing.calcStage &&
    !editing.comment &&
    editing.cfIndent === undefined &&
    mirrorPos
      ? (renderTaggedTactic?.(mirrorPos, editing.value, valueLines) ?? null)
      : null;
  // WHAT AN EMPTY COMMIT DOES, said where the reader is looking
  // (2026-09-28): Enter on an empty comment deletes the line,
  // on an empty tactic it cancels — two behaviours behind one
  // gesture. The textarea's own placeholder carries it where it
  // fits the editor's width; a narrow tactic box (`rw [ih]`)
  // cannot hold the sentence and the editor's size is not ours
  // to change, so the hint hangs BELOW it instead. Both are
  // paint: nothing here is measured.
  const emptyHint =
    editing.value !== "" || editing.add || editing.calcStage
      ? null
      : editing.comment
        ? editing.original === ""
          ? "Enter with nothing adds no comment · Esc cancels"
          : "Enter deletes this comment · Esc keeps it"
        : "Enter with nothing cancels — the trash deletes a step";
  const hintFits =
    emptyHint !== null &&
    measureText(emptyHint, editFontPx, !!editing.comment) <= fw - 2 * NODE_PAD;
  // Gecko CLIPS a foreignObject's content to its box whatever
  // its `overflow` (Blink and WebKit paint the spill), so the
  // box grows to hold what hangs below the editor — the
  // completion list, the empty-commit label — and lets clicks
  // through where it is empty (pointer-events on the editor's
  // own div only).
  const boxW = fw + EDIT_STROKE;
  const boxH = fh + EDIT_STROKE;
  const spillH = completion
    ? EDIT_STROKE + 2 + COMPLETION_MAX_H + 12
    : emptyHint !== null && !hintFits
      ? LINE_H + 12
      : 0;
  const spillW = completion
    ? Math.max(0, COMPLETION_MAX_W + 12 - boxW)
    : emptyHint !== null && !hintFits
      ? Math.max(0, measureText(emptyHint, COMMENT_FONT_PX, true) + 24 - boxW)
      : 0;
  return (
    <g transform={`translate(${en.x},${en.y})`}>
      <foreignObject
        x={-w / 2 - EDIT_STROKE / 2}
        y={overlayY - EDIT_STROKE / 2}
        width={boxW + spillW}
        height={boxH + spillH}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          data-ptw-edit=""
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "grid",
            gridTemplateColumns: `${boxW}px`,
            gridTemplateRows: `${boxH}px auto`,
            width: boxW,
            pointerEvents: "auto",
          }}
        >
          {editHighlight && (
            <div
              data-ptw-mirror=""
              aria-hidden
              style={{
                ...editOverlayLayer(),

                borderRadius: editOuterRx,
                background: editBg,
                color: EDIT_TEXT,
              }}
            >
              {valueLines.map((line, j) => (
                <div key={j} style={{ height: LINE_H }}>
                  {editHighlight[j] ?? line}
                </div>
              ))}
            </div>
          )}
          <textarea
            key={editing.calcStage?.stage ?? "edit"}
            autoFocus
            value={editing.value}
            spellCheck={false}
            data-ptw-hint=""
            placeholder={hintFits ? (emptyHint ?? "") : ""}
            onScroll={(e) => {
              const m =
                e.currentTarget.parentElement?.querySelector(
                  "[data-ptw-mirror]",
                );
              if (m instanceof HTMLElement) {
                m.scrollTop = e.currentTarget.scrollTop;
                m.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            onChange={(e) => {
              const { value, selectionStart } = e.target;
              setEditing((cur) => cur && { ...cur, value });

              if (!editing.comment)
                refreshCompletion(editing.id, value, selectionStart);
              syncAbbrev(editKey(editing)!, value, selectionStart);
            }}
            onSelect={(e) => {
              const ta = e.currentTarget;
              if (completion)
                refreshCompletion(editing.id, ta.value, ta.selectionStart);

              syncAbbrev(editKey(editing)!, ta.value, ta.selectionStart);
            }}
            onClick={(e) => {
              e.stopPropagation();

              syncAbbrev(
                editKey(editing)!,
                e.currentTarget.value,
                e.currentTarget.selectionStart,
              );
            }}
            onKeyUp={(e) =>
              syncAbbrev(
                editKey(editing)!,
                e.currentTarget.value,
                e.currentTarget.selectionStart,
              )
            }
            onDoubleClick={(e) => e.stopPropagation()}
            onCopy={() => (nativeClipRef.current = true)}
            onCut={() => (nativeClipRef.current = true)}
            onPaste={() => (nativeClipRef.current = true)}
            onKeyDown={(e) => {
              e.stopPropagation();
              const mod = e.metaKey || e.ctrlKey;
              const k = e.key.toLowerCase();
              const ta = e.currentTarget;
              if (mod && k === "a") {
                e.preventDefault();
                ta.setSelectionRange(0, ta.value.length);
                return;
              }
              if (mod && (k === "c" || k === "x" || k === "v")) {
                nativeClipRef.current = false;
                window.setTimeout(() => {
                  if (!nativeClipRef.current)
                    void clipboardFallback(k, ta, editing);
                }, 0);
                return;
              }

              if (e.key === "Tab" && !mod) {
                if (abbrevSess?.session.expand()) {
                  e.preventDefault();
                  putSpans([]);
                  return;
                }
              }

              if (completion && !mod) {
                const n = completion.items.length;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const d = e.key === "ArrowDown" ? 1 : n - 1;
                  setCompletion({
                    ...completion,
                    index: (completion.index + d) % n,
                  });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  const sel = completion.items[completion.index];

                  if (e.key === "Enter" && sel.exact) {
                    setCompletion(null);
                  } else {
                    e.preventDefault();
                    acceptCompletion(editing, sel, ta);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setCompletion(null);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(null);
              } else if (
                e.key === "Enter" &&
                (e.metaKey ||
                  e.ctrlKey ||
                  (!e.shiftKey && !editing.original.includes("\n")))
              ) {
                e.preventDefault();
                commitEdit();
              }
            }}
            onBlur={() => {
              if (editingRef.current?.calcStage) return;
              // The playground is a page in a browser: a blur
              // because the WINDOW went to the back (the reader
              // left to look something up) is not a commit — the
              // editor keeps its text and the browser hands it
              // focus back on return. The widget's webview loses
              // window focus to its own source editor, where the
              // blur has always meant commit, so it keeps that.
              if (caps.play && !document.hasFocus()) return;
              commitEdit();
            }}
            style={{
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              fontFamily: getCodeFontFamily(),

              fontSize: editFontPx,
              fontStyle: editing.comment ? "italic" : undefined,
              lineHeight: `${editLineH}px`,
              letterSpacing: 0,
              padding: `${NODE_PAD_Y + EDIT_STROKE / 2}px ${NODE_PAD + EDIT_STROKE / 2}px`,

              gridArea: EDIT_CELL,
              background: editHighlight ? "transparent" : editBg,

              color:
                editHighlight && editing.value !== ""
                  ? "transparent"
                  : EDIT_TEXT,
              caretColor: EDIT_TEXT,

              // EDIT_STROKE is the ACCENTED box's own stroke, and
              // the foreignObject is grown by half of it on every
              // side, so this border lands exactly on the outline
              // the box was drawing.
              border: 0,
              boxShadow: `inset 0 0 0 ${EDIT_STROKE}px ${
                editing.comment ? PROSE_FILL : FOCUS_INK
              }`,
              borderRadius: editOuterRx,
              outline: "none",
              resize: "none",
              whiteSpace: "pre",
              overflowX: "hidden",

              overflowY: "auto",

              userSelect: "text",
            }}
          />
          {emptyHint !== null && !hintFits && (
            <div
              aria-hidden
              style={{
                gridArea: EDIT_SPILL_CELL,
                justifySelf: "start",
                alignSelf: "start",
                marginTop: 4,
                pointerEvents: "none",
                whiteSpace: "nowrap",
                padding: "1px 6px",
                borderRadius: CHROME_RADIUS,
                background: "var(--ptw-bg)",
                color: "var(--ptw-comment)",
                fontStyle: "italic",
                fontFamily: getCodeFontFamily(),
                fontSize: COMMENT_FONT_PX,
              }}
            >
              {emptyHint}
            </div>
          )}
          {abbrevSpans.length > 0 && (
            <div
              aria-hidden
              style={{
                ...editOverlayLayer(),

                color: "transparent",
              }}
            >
              {underlineRuns(editing.value, abbrevSpans).map((runs, j) => (
                <div key={j} style={{ height: LINE_H }}>
                  {runs.map((r, k) =>
                    r.mark ? (
                      <span
                        key={k}
                        style={{
                          textDecoration: "underline",
                          textDecorationColor: EDIT_TEXT,
                        }}
                      >
                        {r.text}
                      </span>
                    ) : (
                      <span key={k}>{r.text}</span>
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
          {completion && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              style={{
                gridArea: EDIT_SPILL_CELL,
                justifySelf: "start",
                alignSelf: "start",
                // The foreignObject starts EDIT_STROKE/2 outside
                // the rect and the spill row starts at the box's
                // bottom (boxH = fh + EDIT_STROKE), so these keep
                // the list where it was: flush with the box's
                // left edge, 2px under its outline.
                marginTop: 2,
                marginLeft: EDIT_STROKE / 2,
                minWidth: Math.min(fw, 240),
                maxWidth: COMPLETION_MAX_W,
                maxHeight: COMPLETION_MAX_H,
                overflowY: "auto",

                background: EDIT_BG,
                color: EDIT_TEXT,
                border: `1px solid ${NODE_STYLES.tactic.stroke}`,
                borderRadius: CHROME_RADIUS,
                fontFamily: getCodeFontFamily(),
                fontSize: NODE_FONT_PX,
                lineHeight: `${LINE_H}px`,
                letterSpacing: 0,
                boxShadow: POPUP_CHROME.boxShadow,
              }}
            >
              {completion.items.map((it, i) => (
                <div
                  key={`${it.kind}:${it.label}`}
                  onClick={(e) =>
                    acceptCompletion(
                      editing,
                      it,

                      e.currentTarget
                        .closest("[data-ptw-edit]")
                        ?.querySelector("textarea") ?? null,
                    )
                  }
                  onMouseEnter={() =>
                    setCompletion((c) => c && { ...c, index: i })
                  }
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    padding: "1px 6px",
                    cursor: "pointer",
                    whiteSpace: "pre",

                    background:
                      i === completion.index
                        ? "var(--ptw-accent)"
                        : "transparent",
                    color:
                      i === completion.index
                        ? "var(--ptw-accent-text)"
                        : EDIT_TEXT,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {it.label}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      opacity: DIM_OPACITY,
                      fontSize: COMMENT_FONT_PX,
                    }}
                  >
                    {it.kind}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </foreignObject>
      {/* The node's MARK stays on screen while it is edited:
          the same tab, ABOVE the editor and fully inert, so
          the edit neither hides the mark (which read as it
          being deleted) nor lets it take a click meant for
          the caret. */}
      {editTab && (
        <TourTab
          inert
          cx={-w / 2}
          cy={boxTop}
          n={editTab.n}
          total={tabStops.length}
          mine={editTab.who === "mine"}
          on={editing.id === currentStopId}
          font={codeFont}
        />
      )}
    </g>
  );
}
