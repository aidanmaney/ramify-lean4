// The barrel the probe runner bundles for node. Everything here must be a PURE
// module (no React, no infoview imports); layout.ts is fine because its
// measureText falls back to character widths without a document.
export * from "../src/proofToTree";
export * from "../src/elide";
export * from "../src/layout";
export * from "../src/layoutKey";
export * from "../src/tour";
export * from "../src/narrate";
export * from "../src/briefLabel";
export * from "../src/deleteEdit";
export * from "../src/rewrite";
export * from "../src/rename";
export * from "../src/lints";
export * from "../src/flagEdit";
export * from "../src/calcEdit";
export * from "../src/diagnostics";
export * from "../src/completion";
export * from "../src/trace";
export * from "../src/paperproof";
export { layoutArgs } from "../src/viewModes";
export { describePreset, EXPERIENCES } from "../src/experience";
export type * from "../src/types";
export * from "../src/matrixScenes";
export * from "../src/matrixCells";
// The static viewer's pure modules (`probe viewer`).
export { checkPayload, PayloadError, PAYLOAD_VERSION, proofSlug } from "../src/viewerPayload";
export { parseLink, formatLink } from "../src/viewerLink";
export { lexPaint } from "../src/sourceLex";
export { GESTURES, gestureShown, gestureText } from "../src/gestures";
export { flattenTaggedText } from "../src/taggedText";
export { HYP_MODES, LAYOUT_MODES, COMMENT_MODES } from "../src/viewModes";
// The settings behind the band (`probe settings`).
export {
  SETTING_KEY, SETTING_DOMAIN, LAYOUT_SETTING, CONTEXT_SETTING, COMMENTS_SETTING,
  parseViewSettings, settingValue, parseSettingsQuery, parseWidth,
} from "../src/viewSettings";
export { PRESETS, READING_OPTIONS, readingOn } from "../src/experience";
