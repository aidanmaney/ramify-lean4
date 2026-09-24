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
 * | comments              | narrate       | show          | show       |
 * | context               | all           | used          | used       |
 * | brief                 | off           | off           | on         |
 *
 * The hover bar is ICONS ONLY at every level (2026-09-22: words on the bar
 * were "way too aggro", and the `⋯` menu is where a glyph is explained). Its
 * row here is WHICH buttons: `default` is moves.ts's `DEFAULT_BAR` (» ◎ ◌ ⊹
 * trash, then `⋯`), and a beginner's tactic bar also carries `⁇` — "what did
 * `simp` use?" is the question a beginner is asking of automation. The
 * `ramify.hoverBar.*` settings WIN where set (the companion only sends a list
 * the reader chose, read with `inspect()`), and a pin in the `⋯` menu wins
 * over both for the session.
 *
 * The hypothesis → origin connector (hovering a context line) is OFF at every
 * level; it is a reading option, not a preset row.
 *
 * Pure: the widget (settings from the companion's theme file) and the harness
 * (`?experience=`) both read it. */
import type { HypMode } from "./proofToTree";
import { DEFAULT_BAR, type MoveId } from "./moves";

export type Experience = "beginner" | "intermediate" | "expert";

export const EXPERIENCES: readonly Experience[] = [
  "beginner",
  "intermediate",
  "expert",
];

export const DEFAULT_EXPERIENCE: Experience = "intermediate";

/** The comment switch's stops, as the view names them. */
export type PresetCommentMode = "shown" | "hidden" | "instead" | "narrate";

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
  comments: PresetCommentMode;
  context: HypMode;
  brief: boolean;
}

export const PRESETS: Record<Experience, Preset> = {
  beginner: {
    hoverBar: {
      tactic: ["source", "focus", "skip", "path", "trace", "delete"],
      goal: DEFAULT_BAR,
    },
    autoTrace: true,
    offerCollapse: false,
    lints: true,
    comments: "narrate",
    context: "full",
    brief: false,
  },
  intermediate: {
    hoverBar: { tactic: DEFAULT_BAR, goal: DEFAULT_BAR },
    autoTrace: false,
    offerCollapse: true,
    lints: true,
    comments: "shown",
    context: "used",
    brief: false,
  },
  expert: {
    hoverBar: { tactic: DEFAULT_BAR, goal: DEFAULT_BAR },
    autoTrace: false,
    offerCollapse: true,
    lints: false,
    comments: "shown",
    context: "used",
    brief: true,
  },
};

/** Anything that is not one of the three names is the default. */
export function parseExperience(v: unknown): Experience {
  return typeof v === "string" &&
    (EXPERIENCES as readonly string[]).includes(v)
    ? (v as Experience)
    : DEFAULT_EXPERIENCE;
}
