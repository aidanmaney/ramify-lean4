import {
  AbbreviationProvider,
  AbbreviationRewriter,
  Range,
  type AbbreviationTextSource,
  type Change,
  type SelectionMoveMode,
} from "@leanprover/unicode-input";

export interface AbbrevConfig {
  enabled: boolean;

  leader: string;

  eager: boolean;

  custom: Record<string, string>;
}

export const DEFAULT_ABBREV: AbbrevConfig = {
  enabled: true,
  leader: "\\",
  eager: true,
  custom: {},
};

export interface AbbrevSpan {
  offset: number;
  length: number;
}

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

function applyChanges(text: string, changes: Change[]): string {
  let out = text;
  for (const c of [...changes].sort((x, y) => y.range.offset - x.range.offset))

    out =
      out.slice(0, c.range.offset) +
      c.newText +
      out.slice(c.range.offset + c.range.length);
  return out;
}

export interface AbbrevRun {
  text: string;
  mark: boolean;
}

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
    at = end + 1;
  }
  return out;
}

export class AbbrevSession implements AbbreviationTextSource {
  private readonly rewriter: AbbreviationRewriter;

  private text: string;
  private caret: number;

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

  expand(): boolean {
    if (this.rewriter.getTrackedAbbreviations().size === 0) return false;
    this.run(() => this.rewriter.replaceAllTrackedAbbreviations());
    return true;
  }

  flush(): string {
    void this.rewriter.replaceAllTrackedAbbreviations();
    return this.text;
  }

  pending(): AbbrevSpan[] {
    return [...this.rewriter.getTrackedAbbreviations()].map((a) => ({
      offset: a.range.offset,
      length: a.range.length,
    }));
  }

  private run(work: () => Promise<void>): void {
    const before = this.text;
    void work().then(() => {
      if (this.text !== before) this.emit(this.text, this.caret);
    });
  }

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
