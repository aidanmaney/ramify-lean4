/** THE SETTINGS BEHIND THE BAND (batch 5, 2026-10-04). Every band / panel
 * value a reader would want to keep is backed by a VS Code setting —
 * `ramify.view.*`, `ramify.reading.*`, `ramify.diagnostics.autoOpen` — and
 * the layering is, top wins:
 *
 *   session override (`useOverride`, the row the reader just changed)
 *   → the setting, where the reader SET it (the companion reads `inspect()`
 *     and sends nothing for an unset key)
 *   → the `ramify.experience` preset (experience.ts), where it has a row
 *   → the view's own default.
 *
 * A band change sets the override AND asks the companion to write the
 * setting (`popoutEdit` action `setting` → `settings-request.json`); when the
 * written value comes back through the theme file the default has moved, and
 * `useOverride` lets go of an override set over a default that has since
 * moved, so the two layers collapse into one by themselves.
 *
 * The SETTING's domain is the reader's vocabulary where the code's ids are
 * private (`view.layout` says `outline`, the band's word, for the code's
 * `stacked`; `view.context` says `intro`/`diff`/`all` for `new`/`delta`/
 * `full`), and the code's ids where the band's word is not an identifier
 * (`view.comments` takes `shown|hidden|instead|narrate` — the band's `in
 * place` has a space). `view.width` is `"full"` or a column budget, the Width
 * slider's own domain.
 *
 * The extension keeps the same table in CommonJS (ext/ramify/settingWrites.js
 * — it has no build step); `probe settings` asserts the two equal.
 *
 * Pure: the widget parses the theme file's `prefs` with it; the harness
 * parses `?settings=`. */
import type { LayoutMode, CommentMode } from "./viewModes";
import type { HypMode } from "./proofToTree";
import { REFLOW_MAX_CHARS, REFLOW_MIN_CHARS, type ReflowMode } from "./layout";

export interface ViewSettings {
  layout?: LayoutMode;
  sideBySide?: boolean;
  gallery?: boolean;
  width?: ReflowMode;
  context?: HypMode;
  hypGroup?: boolean;
  comments?: CommentMode;
  brief?: boolean;
  merge?: boolean;
  lints?: boolean;
  hypOrigins?: boolean;
  upToCursor?: boolean;
  autoOpen?: boolean;
}

export type ViewSettingId = keyof ViewSettings;

/** What the companion can be asked to write: every `ViewSettingId` plus
 `appearance` (the Layout panel's `classic look` row, its own setting since
 the classic skin landed). */
export type SettingId = ViewSettingId | "appearance";

/** The theme file's `prefs` key → the setting under `ramify.`. */
export const SETTING_KEY: Record<SettingId, string> = {
  layout: "view.layout",
  sideBySide: "view.sideBySide",
  gallery: "view.gallery",
  width: "view.width",
  context: "view.context",
  hypGroup: "view.hypGroup",
  comments: "view.comments",
  brief: "reading.brief",
  merge: "reading.merge",
  lints: "reading.lints",
  hypOrigins: "reading.hypOrigins",
  upToCursor: "reading.upToCursor",
  autoOpen: "diagnostics.autoOpen",
  appearance: "appearance",
};

/** Code id → the setting's word. */
export const LAYOUT_SETTING: Record<LayoutMode, string> = {
  stacked: "outline",
  spine: "spine",
  tracks: "tracks",
  wide: "wide",
};
export const CONTEXT_SETTING: Record<HypMode, string> = {
  used: "used",
  new: "intro",
  delta: "diff",
  full: "all",
};
export const COMMENTS_SETTING: Record<CommentMode, string> = {
  shown: "shown",
  hidden: "hidden",
  instead: "instead",
  narrate: "narrate",
};

/** Every setting's value domain, in SETTING words: an enum's values, or the
 kind. One table: `probe settings` compares it with the extension's. */
export const SETTING_DOMAIN: Record<SettingId, readonly string[] | "boolean" | "width"> = {
  layout: Object.values(LAYOUT_SETTING),
  sideBySide: "boolean",
  gallery: "boolean",
  width: "width",
  context: Object.values(CONTEXT_SETTING),
  hypGroup: "boolean",
  comments: Object.values(COMMENTS_SETTING),
  brief: "boolean",
  merge: "boolean",
  lints: "boolean",
  hypOrigins: "boolean",
  upToCursor: "boolean",
  autoOpen: "boolean",
  appearance: ["vscode", "classic"],
};

const invert = <K extends string>(m: Record<K, string>): Map<string, K> =>
  new Map((Object.entries(m) as [K, string][]).map(([k, v]) => [v, k]));
const LAYOUT_OF = invert(LAYOUT_SETTING);
const CONTEXT_OF = invert(CONTEXT_SETTING);
const COMMENTS_OF = invert(COMMENTS_SETTING);

const BOOL_IDS = [
  "sideBySide",
  "gallery",
  "hypGroup",
  "brief",
  "merge",
  "lints",
  "hypOrigins",
  "upToCursor",
  "autoOpen",
] as const;

/** A width setting as the slider's value: `"full"` → `"off"`, an integer
 in the slider's range → itself; anything else is not a width. */
export const parseWidth = (v: unknown): ReflowMode | undefined =>
  v === "full"
    ? "off"
    : typeof v === "number" &&
        Number.isInteger(v) &&
        v >= REFLOW_MIN_CHARS &&
        v <= REFLOW_MAX_CHARS
      ? v
      : undefined;

/** The theme file's `prefs` object (or the harness's), validated key by key:
 an unknown key, a value outside its domain, `null` and absence all read as
 UNSET — the preset decides. Never throws. */
export function parseViewSettings(raw: unknown): ViewSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: ViewSettings = {};
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  const layout = LAYOUT_OF.get(str("layout"));
  if (layout) out.layout = layout;
  const context = CONTEXT_OF.get(str("context"));
  if (context) out.context = context;
  const comments = COMMENTS_OF.get(str("comments"));
  if (comments) out.comments = comments;
  const width = parseWidth(r.width);
  if (width !== undefined) out.width = width;
  for (const k of BOOL_IDS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out;
}

/** A view value as the setting stores it (what the companion is asked to
 write). */
export function settingValue(id: SettingId, v: unknown): string | number | boolean {
  switch (id) {
    case "layout":
      return LAYOUT_SETTING[v as LayoutMode];
    case "context":
      return CONTEXT_SETTING[v as HypMode];
    case "comments":
      return COMMENTS_SETTING[v as CommentMode];
    case "width":
      return v === "off" ? "full" : (v as number);
    default:
      return v as string | boolean;
  }
}

/** The harness's `?settings=layout:wide,brief:true,width:44` — the theme
 file's `prefs` without a companion, in the same words. */
export function parseSettingsQuery(q: string | null): ViewSettings {
  if (!q) return {};
  const raw: Record<string, unknown> = {};
  for (const part of q.split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    raw[k] =
      v === "true" ? true : v === "false" ? false : /^\d+$/.test(v) ? Number(v) : v;
  }
  return parseViewSettings(raw);
}
