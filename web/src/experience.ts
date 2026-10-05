/** `ramify.experience` — ONE setting that fills the DEFAULTS of several others
 * (2026-09-22, the table below is the user's). It never overrides a choice:
 * every row the reader can change in the session is held as an OVERRIDE
 * (`T | null`) beside this default — the C4 `polishOverride` idiom — so a
 * preset arriving late from the companion re-reads the defaults without an
 * effect, and a row the reader has set keeps the reader's value.
 *
 * |                       | beginner      | intermediate  | expert     |
 * |-----------------------|---------------|---------------|------------|
 * | hover bar (tactics)   | default + ⁇   | default       | default    |
 * | automation trace      | auto (cursor) | on click      | on click   |
 * | replace with auto (⇓) | hidden        | offered       | offered    |
 * | lints                 | on            | on            | off        |
 * | comments              | show          | show          | show       |
 * | context               | used          | used          | used       |
 * | brief                 | off           | off           | off        |
 * | hypothesis origins    | on            | off           | off        |
 *
 * The hover bar is ICONS ONLY at every level (2026-09-22: words on the bar
 * were "way too aggro", and the `⋯` menu is where a glyph is explained). Its
 * row here is WHICH buttons: `default` is moves.ts's `DEFAULT_BAR` (» ◎ ◌ ⊹
 * lightbulb trash, then `⋯`), and a beginner's tactic bar also carries `⁇`,
 * just before the trash — "what did `simp` use?" is the question a beginner
 * is asking of automation. The lightbulb (batch 4) is on every level's bar:
 * it is the one door to the fixes and refactorings, greyed where there are
 * none, so it costs nothing where it has nothing to say. The
 * `ramify.hoverBar.*` settings WIN where set (the companion only sends a list
 * the reader chose, read with `inspect()`), and a pin in the `⋯` menu wins
 * over both for the session.
 *
 * The hypothesis → origin connector (hovering a context line) is a preset
 * row since 2026-09-28: ON for a beginner, who is asking where a hypothesis
 * came from, OFF elsewhere; the reading option overrides it for the session.
 *
 * RETUNED 2026-10-04 (batch 5, owner-approved; verdict Q3): the beginner
 * preset gave the reader least able to filter the most — Context `all` and
 * narration on — so a beginner now starts at Context `used` and Comments
 * `show` (origins and `⁇` stay); expert's `brief` is off (it dropped a
 * `have`'s statement, the expert's own complaint). Every row is also a VS
 * Code setting now (viewSettings.ts): the preset fills only what the reader
 * has not SET.
 *
 * Pure: the widget (settings from the companion's theme file) and the harness
 * (`?experience=`) both read it. */
import type { HypMode } from "./proofToTree";
import { DEFAULT_BAR, MOVE_MARK, type MoveId } from "./moves";
import { COMMENT_MODES, HYP_MODES, type CommentMode } from "./viewModes";

export type Experience = "beginner" | "intermediate" | "expert";

export const EXPERIENCES: readonly Experience[] = [
  "beginner",
  "intermediate",
  "expert",
];

export const DEFAULT_EXPERIENCE: Experience = "intermediate";

export interface Preset {
  /** The hover bar's buttons, per node kind, where no setting names them. */
  hoverBar: { tactic: readonly MoveId[]; goal: readonly MoveId[] };
  /** The trace (`⁇`) of the automation step under the CURSOR opens by
   itself — fetched lazily, for that one step. */
  autoTrace: boolean;
  /** `⇓` (replace a run with one automation tactic) is offered. */
  offerCollapse: boolean;
  /** The `lints` reading option's default. */
  lints: boolean;
  comments: CommentMode;
  context: HypMode;
  brief: boolean;
  /** The `hypothesis origins` reading option's default. */
  hypOrigins: boolean;
}

export const PRESETS: Record<Experience, Preset> = {
  beginner: {
    hoverBar: {
      tactic: ["source", "focus", "skip", "path", "fix", "trace", "delete"],
      goal: DEFAULT_BAR,
    },
    autoTrace: true,
    offerCollapse: false,
    lints: true,
    comments: "shown",
    context: "used",
    brief: false,
    hypOrigins: true,
  },
  intermediate: {
    hoverBar: { tactic: DEFAULT_BAR, goal: DEFAULT_BAR },
    autoTrace: false,
    offerCollapse: true,
    lints: true,
    comments: "shown",
    context: "used",
    brief: false,
    hypOrigins: false,
  },
  expert: {
    hoverBar: { tactic: DEFAULT_BAR, goal: DEFAULT_BAR },
    autoTrace: false,
    offerCollapse: true,
    lints: false,
    comments: "shown",
    context: "used",
    brief: false,
    hypOrigins: false,
  },
};

/** Anything that is not one of the three names is the default. */
export function parseExperience(v: unknown): Experience {
  return typeof v === "string" &&
    (EXPERIENCES as readonly string[]).includes(v)
    ? (v as Experience)
    : DEFAULT_EXPERIENCE;
}

/** THE READING OPTIONS — the eye's panel rows, in the panel's order. One
 table feeds the panel (label and tip), `readingOn` (the eye's dot and tip),
 the view's appliers (the toast's `Name: on`) and `describePreset` (the rows a
 preset fills: those with a `presetKey`). `polish`'s tip and `up to cursor`'s
 when unusable are the view's to say (they depend on state). `suggest a
 rewrite` is an action, not an option, and is not here. */
export type ReadingId =
  | "brief"
  | "merge"
  | "lints"
  | "hypOrigins"
  | "polish"
  | "upToCursor"
  | "autoOpen";

export interface ReadingOption {
  id: ReadingId;
  label: string;
  title: string;
  /** The `Preset` field that is this option's default, where a preset has one. */
  presetKey?: "brief" | "lints" | "hypOrigins";
  /** Left out of `readingOn` (the Reading item's emphasis and tip): an
   option that is ON by default would light the item for everyone. */
  quiet?: boolean;
}

export const READING_OPTIONS: readonly ReadingOption[] = [
  {
    id: "brief",
    label: "brief",
    title: "Hide boilerplate inside each tactic's own text",
    presetKey: "brief",
  },
  { id: "merge", label: "merge", title: "One node per straight run of tactics" },
  {
    id: "lints",
    label: "lints",
    title:
      "Show Mathlib's own style linters on the steps they object to — the declaration is re-elaborated once to ask",
    presetKey: "lints",
  },
  {
    id: "hypOrigins",
    label: "hypothesis origins",
    title:
      "Hovering a context line points at the step that introduced it, and lights that step",
    presetKey: "hypOrigins",
  },
  { id: "polish", label: "polish", title: "" },
  {
    id: "upToCursor",
    label: "up to cursor",
    title: "Draw only down to the editor cursor",
  },
  {
    // `ramify.diagnostics.autoOpen` (batch 5): the owner's derived-open rule
    // (a NEW error opens the message strip) as an option, default ON.
    id: "autoOpen",
    label: "errors open the message strip",
    title:
      "A new error opens the message strip above the band by itself; off, only the problems count opens it",
    quiet: true,
  },
];

const readingLabel = (id: ReadingId) =>
  READING_OPTIONS.find((o) => o.id === id)!.label;

/** A toast's `Name` for an option: its label, sentence case (`Up to cursor`). */
export const readingName = (id: ReadingId): string => {
  const l = readingLabel(id);
  return l.charAt(0).toUpperCase() + l.slice(1);
};

/** The reading options as they stand, EFFECTIVE: `polish` is on only where its
 row is drawn and answerable, `upToCursor` only where the cursor exists. */
export type ReadingState = Record<ReadingId, boolean>;

/** The options that are ON, in the panel's order — what the eye's tip lists,
 * and the ONE dot under the eye is `readingOn(...).length > 0`: absolute
 * meaning, like every other slot (lit = on), not "differs from the preset"
 * (which read as a contradiction beside a "defaults (changed)" tip).
 * `suggest a rewrite` is an action and never counts. */
export const readingOn = (s: ReadingState): string[] =>
  READING_OPTIONS.filter((o) => !o.quiet && s[o.id]).map((o) => o.label);

/** What a preset does, as `[name, value]` rows in one fixed order — the one
 * source for the extension's `ramify.experience` descriptions, its quick pick
 * and INSTALL.md's table (scripts/gen-experience.mjs). */
export function describePreset(level: Experience): [string, string][] {
  const p = PRESETS[level];
  const extras = p.hoverBar.tactic
    .filter((id) => !DEFAULT_BAR.includes(id))
    .map((id) => MOVE_MARK[id]);
  const onOff = (b: boolean) => (b ? "on" : "off");
  const optionRow = (id: ReadingId): [string, string] => {
    const key = READING_OPTIONS.find((o) => o.id === id)!.presetKey!;
    return [readingName(id), onOff(p[key])];
  };
  return [
    ["Comments", COMMENT_MODES[p.comments].name],
    ["Context", HYP_MODES[p.context].name],
    optionRow("brief"),
    optionRow("lints"),
    optionRow("hypOrigins"),
    [
      "Automation trace",
      p.autoTrace ? "opens by itself for the step under the cursor" : "on click",
    ],
    [
      "Tactic hover bar",
      extras.length ? `default, plus ${extras.join(" ")}` : "default",
    ],
    ["Replace with automation (⇓)", p.offerCollapse ? "offered" : "not offered"],
  ];
}
