// The static viewer's payload: one JSON file per published source file.
//
//   { version, file, source, hovers, proofs: [{ name, index, proof }] }
//
// `proof` is the CLI record (`ppharness --widget-data`): today's NDJSON proof
// plus the widget-only groups, with tagged goals and token hovers BAKED — every
// tag carries `{h}`, an index into the file's `hovers` table, where the RPC
// would carry a reference the infoview resolves on hover. `web/scripts/
// publish.mjs` builds it and interns the hovers per FILE (a docstring that
// three proofs hover is stored once).
//
// The format is VERSIONED. A page reads only the version it was built for and
// says so plainly otherwise, rather than drawing a payload it misreads.
import type { RawDiagnostic } from "./diagnostics";
import type { Proof } from "./paperproof";
import type { LabelToken, TacticToken, TacticTokenInfoOf } from "./tacticCore";
import type { TaggedGoalEntryOf } from "./taggedCore";

export const PAYLOAD_VERSION = 1;

/** A baked tag: the popup it shows and, on a goal, its diff status. */
export interface BakedTag {
  h: number;
  diffStatus?:
    | "wasChanged"
    | "willChange"
    | "wasDeleted"
    | "willDelete"
    | "wasInserted"
    | "willInsert";
}

/** What core's `makePopup` answers, printed plain at harvest time. */
export interface BakedPopup {
  expr?: string;
  type?: string;
  doc?: string;
}

type LspPos = { line: number; character: number };

/** One tight tactic edit (the widget's `TacticEditEntry`): read here for its
 tokens (label colouring) and its tight range (`»` in the source pane). */
export interface TacticEditEntry {
  stepStart: LspPos;
  start: LspPos;
  stop: LspPos;
  text: string;
  tokens?: TacticToken[];
  labelTokens?: LabelToken[];
  tacticIndent?: number;
}

/** The widget-only groups, as the CLI writes them. */
export interface BakedFields {
  diagnostics?: RawDiagnostic[];
  tacticEdits?: TacticEditEntry[];
  taggedGoals?: TaggedGoalEntryOf<BakedTag>[];
  tokenInfos?: TacticTokenInfoOf<BakedTag>[];
}

export type ViewerProofData = Proof & BakedFields;

export interface ViewerProof {
  /** The declaration's name; null for an `example`. */
  name: string | null;
  /** The record's index in the file (the CLI's `index`). */
  index: number;
  proof: ViewerProofData;
}

export interface ViewerPayload {
  version: typeof PAYLOAD_VERSION;
  /** The source file's path as published (`proofs/euclid.lean`). */
  file: string;
  /** The whole source text, for the source pane. */
  source: string;
  hovers: BakedPopup[];
  proofs: ViewerProof[];
}

/** A payload this page cannot read, with the reason a reader can act on. */
export class PayloadError extends Error {}

/** Check a parsed payload's shape and version. Throws `PayloadError`. */
export function checkPayload(raw: unknown): ViewerPayload {
  if (!raw || typeof raw !== "object")
    throw new PayloadError("The proof data is not a JSON object.");
  const p = raw as Partial<ViewerPayload> & { version?: unknown };
  if (p.version !== PAYLOAD_VERSION)
    throw new PayloadError(
      p.version === undefined
        ? "The proof data has no format version. It was not made by publish.mjs, or by a version older than this page."
        : `The proof data is format version ${String(p.version)}; this page reads version ${PAYLOAD_VERSION}. Publish it again with the matching tools.`,
    );
  if (
    typeof p.file !== "string" ||
    typeof p.source !== "string" ||
    !Array.isArray(p.proofs) ||
    !Array.isArray(p.hovers)
  )
    throw new PayloadError(
      "The proof data is missing its file, source, hovers or proofs.",
    );
  return p as ViewerPayload;
}

/** The id a proof is linked and stashed by: its name, else `@<index>`. */
export function proofSlug(p: ViewerProof): string {
  return p.name ?? `@${p.index}`;
}
