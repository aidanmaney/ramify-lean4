// The static viewer's deep links: what a URL hash names and how it is read
// back. Pure, so a probe can check the round trip.
//
//   view.html#file=euclid&proof=Nat.foo&layout=spine&context=all&comments=narrate
//
// `file` picks a payload (`data/<file>.json`; a single-file export has its
// payload inline and ignores it), `proof` a declaration by name (`@<index>`
// for an `example`). The three view words are the ones the status bar prints
// (`LAYOUT_MODES[…].name` and its siblings), so a link reads the way the
// control it sets is labelled.
import type { HypMode } from "./proofToTree";
import {
  COMMENT_MODES,
  HYP_MODES,
  LAYOUT_MODES,
  type CommentMode,
  type LayoutMode,
} from "./viewModes";

export interface ViewerLink {
  file?: string;
  proof?: string;
  layout?: LayoutMode;
  context?: HypMode;
  comments?: CommentMode;
}

function byName<K extends string>(
  table: Record<K, { name: string }>,
  word: string | null,
): K | undefined {
  if (word === null) return undefined;
  return (Object.keys(table) as K[]).find((k) => table[k].name === word);
}

export function parseLink(hash: string): ViewerLink {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const out: ViewerLink = {};
  const file = q.get("file");
  const proof = q.get("proof");
  if (file) out.file = file;
  if (proof) out.proof = proof;
  const layout = byName(LAYOUT_MODES, q.get("layout"));
  const context = byName(HYP_MODES, q.get("context"));
  const comments = byName(COMMENT_MODES, q.get("comments"));
  if (layout) out.layout = layout;
  if (context) out.context = context;
  if (comments) out.comments = comments;
  return out;
}

/** The hash for `link`, view words by their bar names. Defaults are left out
 by the caller (it passes only what differs), so a plain link stays short. */
export function formatLink(link: ViewerLink): string {
  const q = new URLSearchParams();
  if (link.file) q.set("file", link.file);
  if (link.proof) q.set("proof", link.proof);
  if (link.layout) q.set("layout", LAYOUT_MODES[link.layout].name);
  if (link.context) q.set("context", HYP_MODES[link.context].name);
  if (link.comments) q.set("comments", COMMENT_MODES[link.comments].name);
  const s = q.toString();
  return s ? `#${s}` : "";
}
