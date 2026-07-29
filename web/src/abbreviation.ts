// Unicode abbreviation input for the in-place tactic editor: typing `\dvd` or
// `\langle` turns into `∣` / `⟨`, exactly as it does in the source buffer.
//
// The table and the state machine are UPSTREAM's — `@leanprover/unicode-input`
// is the very package vscode-lean4 drives the editor's own input mode with, so
// this file reimplements no vocabulary and no replacement rule. What it does is
// adapt that machine to the one thing it has never been pointed at: a
// CONTROLLED React `<textarea>`. Upstream has two hosts, and neither fits —
// vscode-lean4 feeds it a `TextDocument`'s `contentChanges`, and
// `@leanprover/unicode-input-component` drives a `contenteditable` by writing
// `innerHTML`. Ours is a textarea whose value comes from React state and whose
// caret must be restored after the render that applies it (the same constraint
// the clipboard fallback and completion acceptance already live under).
//
// So the adapter owns a SHADOW copy of the text, and the DOM is told about
// changes only through the `emit` callback. Three consequences worth stating,
// since each is a place this could have gone wrong:
//
//   * `AbbreviationRewriter` wants CHANGES (offset, length, newText); a
//     controlled textarea's onChange hands over the whole new value. `diffAt`
//     reconstructs the change, using the CARET to disambiguate rather than
//     prefix/suffix alone — typing `\` immediately before an existing `\` is
//     otherwise attributed to the wrong offset and the tracked abbreviation
//     starts one character off.
//   * Replacement is async in upstream's interface but synchronous in ours, so
//     `flush` can be synchronous (see its comment) — which matters because
//     commit runs from a blur/keydown handler that cannot await.
//   * Nothing here touches the DOM. The session is a plain object, so a probe
//     can drive the real machine over the real 1855-entry table with no React
//     and no browser.

import {
  AbbreviationProvider,
  AbbreviationRewriter,
  Range,
  type AbbreviationTextSource,
  type Change,
  type SelectionMoveMode,
} from "@leanprover/unicode-input";

/** The user's `lean4.input.*` settings. Defaults are vscode-lean4's own, so an
absent companion behaves exactly like an unconfigured editor. */
export interface AbbrevConfig {
  /** `lean4.input.enabled`. Off means the session is never created. */
  enabled: boolean;
  /** `lean4.input.leader` — the key that opens an abbreviation. */
  leader: string;
  /** `lean4.input.eagerReplacementEnabled` — replace as soon as the
  abbreviation identifies a symbol uniquely, without waiting for a boundary. */
  eager: boolean;
  /** `lean4.input.customTranslations` — the user's own additions. */
  custom: Record<string, string>;
}

export const DEFAULT_ABBREV: AbbrevConfig = {
  enabled: true,
  leader: "\\",
  eager: true,
  custom: {},
};

/** A pending abbreviation's span in the draft, for the underline. Offsets, not
line/column: the editor's text is one string and the render slices it. */
export interface AbbrevSpan {
  offset: number;
  length: number;
}

/**
 * Reconstruct the single change that took `old` to `next`, given where the
 * caret ended up.
 *
 * A textarea produces exactly one contiguous change per input event, so one
 * change is always enough. The caret pins WHERE it happened, which prefix and
 * suffix matching alone cannot always do: inserting a character equal to its
 * neighbour is ambiguous, and for the leader specifically that ambiguity moves
 * the tracked abbreviation off by one. Insertions and deletions are both exact
 * under the caret; anything else (a paste over a selection, an undo) falls back
 * to common prefix/suffix, which is right whenever the ends differ.
 */
export function diffAt(old: string, next: string, caret: number): Change | null {
  if (old === next) return null;
  const d = next.length - old.length;
  if (d > 0) {
    const p = caret - d;
    if (
      p >= 0 &&
      old.slice(0, p) === next.slice(0, p) &&
      old.slice(p) === next.slice(caret)
    )
      return { range: new Range(p, 0), newText: next.slice(p, caret) };
  } else if (d < 0) {
    const p = caret;
    if (
      p >= 0 &&
      old.slice(0, p) === next.slice(0, p) &&
      old.slice(p - d) === next.slice(p)
    )
      return { range: new Range(p, -d), newText: "" };
  }
  let a = 0;
  const max = Math.min(old.length, next.length);
  while (a < max && old[a] === next[a]) a++;
  let b = 0;
  while (
    b < max - a &&
    old[old.length - 1 - b] === next[next.length - 1 - b]
  )
    b++;
  return {
    range: new Range(a, old.length - b - a),
    newText: next.slice(a, next.length - b),
  };
}

/** Apply changes to a string. Descending by offset, so an earlier change never
moves a later one's coordinates. */
function applyChanges(text: string, changes: Change[]): string {
  let out = text;
  for (const c of [...changes].sort((x, y) => y.range.offset - x.range.offset))
    // NOT `offsetEnd`, which upstream defines as the last contained offset
    // (`offset + length - 1`), so slicing at it would keep the range's last
    // character — measured, and it reads as an abbreviation expanding one
    // character short (`\alp` → `αp`).
    out =
      out.slice(0, c.range.offset) +
      c.newText +
      out.slice(c.range.offset + c.range.length);
  return out;
}

/** One drawn run of a line: the text, and whether it is part of an
abbreviation still being typed. */
export interface AbbrevRun {
  text: string;
  mark: boolean;
}

/**
 * Split a draft into per-line runs, marking the pending abbreviations.
 *
 * The view paints these as a transparent-text layer over the textarea, so only
 * the underline shows — the same trick the syntax-colouring mirror uses from
 * the other side, and the only way to decorate text under a real caret. Lines
 * are the layer's own geometry, so the split has to happen here rather than in
 * offsets: `value.split("\n")` with one separator charged per boundary.
 */
export function underlineRuns(
  value: string,
  spans: AbbrevSpan[],
): AbbrevRun[][] {
  const lines = value.split("\n");
  const out: AbbrevRun[][] = [];
  let at = 0;
  for (const line of lines) {
    const end = at + line.length;
    const cuts = new Set<number>([0, line.length]);
    for (const s of spans) {
      const lo = Math.max(s.offset, at) - at;
      const hi = Math.min(s.offset + s.length, end) - at;
      if (hi > lo) {
        cuts.add(lo);
        cuts.add(hi);
      }
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const runs: AbbrevRun[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const [lo, hi] = [sorted[i], sorted[i + 1]];
      runs.push({
        text: line.slice(lo, hi),
        mark: spans.some(
          (s) => s.offset <= at + lo && at + hi <= s.offset + s.length,
        ),
      });
    }
    out.push(runs.length > 0 ? runs : [{ text: "", mark: false }]);
    at = end + 1; // the "\n" split consumed
  }
  return out;
}

/**
 * One editing session's worth of abbreviation state.
 *
 * Created when the in-place editor opens and thrown away when it closes — the
 * rewriter's tracked abbreviations are per-buffer state and must not survive
 * onto the next tactic.
 */
export class AbbrevSession implements AbbreviationTextSource {
  private readonly rewriter: AbbreviationRewriter;
  /** The adapter's own copy of the draft. Authoritative WITHIN a replacement:
  React state lags by a render, and the rewriter needs to read and write text
  synchronously while computing one. */
  private text: string;
  private caret: number;
  /** Called after any replacement with the full new draft and where the caret
  should end up. The view writes both through React state. Declared as a field
  rather than a constructor parameter property: `erasableSyntaxOnly` is on. */
  private readonly emit: (value: string, caret: number) => void;

  constructor(
    cfg: AbbrevConfig,
    initial: string,
    emit: (value: string, caret: number) => void,
  ) {
    this.emit = emit;
    this.text = initial;
    this.caret = initial.length;
    this.rewriter = new AbbreviationRewriter(
      {
        abbreviationCharacter: cfg.leader,
        customTranslations: cfg.custom,
        eagerReplacementEnabled: cfg.eager,
      },
      new AbbreviationProvider({
        abbreviationCharacter: cfg.leader,
        customTranslations: cfg.custom,
        eagerReplacementEnabled: cfg.eager,
      }),
      this,
    );
  }

  /**
   * Tell the session what the textarea now holds. ONE entry point rather than
   * separate input/caret hooks, because the view has several events that can
   * report either (`onChange`, `onSelect`, and the two paths that write the
   * draft through state — completion acceptance and the clipboard fallback),
   * and their relative order is not something to depend on. Sync is idempotent:
   * calling it twice with the same pair does nothing the second time.
   *
   * A text change feeds the reconstructed change through and then replaces
   * anything the change finished or (eagerly) completed. A caret move with no
   * text change replaces any abbreviation the caret has LEFT — the buffer's own
   * rule, and what makes clicking away from `\alpha` yield `α`.
   */
  sync(value: string, caret: number): void {
    if (value !== this.text) {
      const change = diffAt(this.text, value, caret);
      this.text = value;
      this.caret = caret;
      if (change) this.rewriter.changeInput([change]);
      this.run(() => this.rewriter.triggerAbbreviationReplacement());
    } else if (caret !== this.caret) {
      this.caret = caret;
      this.run(() => this.rewriter.changeSelections([new Range(caret, 0)]));
    }
  }

  /** Tab: replace everything pending, whether or not it is unambiguous.
  Returns false when nothing was pending, so the caller can fall through to
  whatever else Tab means there. */
  expand(): boolean {
    if (this.rewriter.getTrackedAbbreviations().size === 0) return false;
    this.run(() => this.rewriter.replaceAllTrackedAbbreviations());
    return true;
  }

  /**
   * The draft as it should be COMMITTED: everything still pending replaced.
   * Typing `\alpha` and pressing Enter must write `α`, not `\alpha`.
   *
   * Synchronous, which it has to be — commit runs from a blur/keydown handler
   * that cannot await, and the value is needed in the same tick. That is sound
   * rather than lucky: an `async` body runs to its first `await`, and
   * `forceReplace`'s first `await` is on the call to our own
   * `replaceAbbreviations`, so by the time the promise is returned the text has
   * already been rewritten. Only the caret move is deferred, and commit has no
   * use for a caret. The probe asserts this rather than trusting it, since it
   * is the one place this file depends on upstream's control flow.
   */
  flush(): string {
    void this.rewriter.replaceAllTrackedAbbreviations();
    return this.text;
  }

  /** Spans to underline: what is being typed but not yet replaced. Includes
  the leader (`TrackedAbbreviation.range` does), so the underline starts at the
  `\` — which is what makes it read as one pending token. */
  pending(): AbbrevSpan[] {
    return [...this.rewriter.getTrackedAbbreviations()].map((a) => ({
      offset: a.range.offset,
      length: a.range.length,
    }));
  }

  /**
   * Run one of upstream's async operations and emit only if it actually
   * changed the text — a keystroke that merely extends an abbreviation must
   * not cost a second render.
   *
   * Takes a THUNK, not a promise. The same synchronous-until-first-await fact
   * that `flush` leans on bites from the other side here: passing
   * `rewriter.replaceAll…()` as an argument evaluates it before this function
   * is entered, so the text has ALREADY been rewritten by the time `before` is
   * read and nothing ever looks changed. Measured — every replacement went
   * silently missing while `flush` worked perfectly.
   */
  private run(work: () => Promise<void>): void {
    const before = this.text;
    void work().then(() => {
      if (this.text !== before) this.emit(this.text, this.caret);
    });
  }

  // --- AbbreviationTextSource -------------------------------------------

  replaceAbbreviations(changes: Change[]): Promise<boolean> {
    this.text = applyChanges(this.text, changes);
    return Promise.resolve(true);
  }

  selectionMoveMode(): SelectionMoveMode {
    return { kind: "MoveAllSelections" };
  }

  collectSelections(): Range[] {
    return [new Range(this.caret, 0)];
  }

  setSelections(selections: Range[]): void {
    const first = selections[0];
    if (first) this.caret = first.offset;
  }
}
