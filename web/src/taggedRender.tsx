// The tagged-goal renderers bound to the infoview's `InteractiveCode`: the
// widget's live hovers. The logic is `taggedCore.tsx`'s, shared with the
// static viewer; this file and `tacticTokens.tsx` are the only ones that
// import the infoview.
import { createElement } from "react";
import {
  InteractiveCode,
  type CodeWithInfos,
  type InteractiveGoal,
  type SubexprInfo,
} from "@leanprover/infoview";
import type { Proof } from "./paperproof";
import type { TaggedText } from "./taggedText";
import {
  makeTaggedRenderersWith,
  type TaggedGoalEntryOf,
  type TaggedRenderers,
} from "./taggedCore";

export interface TaggedGoalEntry {
  goalId: string;
  goal: InteractiveGoal;
}

// `createElement`, not JSX: a module-level arrow returning JSX reads to the
// fast-refresh lint as a component, and this module exports functions.
const interactive = (fmt: TaggedText<SubexprInfo>) =>
  createElement(InteractiveCode, { fmt: fmt as CodeWithInfos });

export function makeTaggedRenderers(
  proof: Proof,
  entries: TaggedGoalEntry[],
): TaggedRenderers {
  // The infoview's goal is the core's shape over `SubexprInfo` tags (its
  // `FVarId`s are strings on the wire).
  return makeTaggedRenderersWith<SubexprInfo>(
    proof,
    entries as unknown as TaggedGoalEntryOf<SubexprInfo>[],
    interactive,
  );
}
