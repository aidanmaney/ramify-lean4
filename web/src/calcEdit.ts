import type { ProofStepPosition } from "./paperproof";
import type { AddSpec } from "./types";

export interface DocEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;

  fillNth?: number;

  stages?: {
    lhs: { at: number; len: number };
    rhs: { at: number; len: number };
  };
}

export const STUB = "by sorry";

const STUB_TACTIC = "sorry";

export function dedupLeadingBy(text: string): string {
  const m = /^(\s*)by\s+(\S[\s\S]*)$/.exec(text);
  return m ? m[1] + m[2] : text;
}

export function fillRange(
  start: { line: number; character: number },
  newText: string,
  nth = 1,
): ProofStepPosition | null {
  let idx = -1;
  for (let i = 0; i < nth; i++) {
    idx = newText.indexOf(STUB_TACTIC, idx + 1);
    if (idx < 0) return null;
  }
  return offsetToPosition(start, newText, idx, STUB_TACTIC.length);
}

export function offsetToPosition(
  start: { line: number; character: number },
  newText: string,
  at: number,
  len: number,
): ProofStepPosition {
  const before = newText.slice(0, at);
  const breaks = before.split("\n").length - 1;
  const nl = before.lastIndexOf("\n");
  const pos = {
    line: start.line + breaks,
    character: breaks === 0 ? start.character + at : at - nl - 1,
  };
  return { start: pos, stop: { line: pos.line, character: pos.character + len } };
}

export function calcOpenText(rel: string): string {
  return CALC_KW + calcLinkText(rel);
}

export const PLACEHOLDER = "_";
const CALC_KW = "calc ";

export function calcLinkText(rel: string): string {
  return `${PLACEHOLDER} ${rel} ${PLACEHOLDER} := ${STUB}`;
}

export function calcLinkSlots(
  rel: string,
  lead = 0,
): {
  lhs: { at: number; len: number };
  rhs: { at: number; len: number };
  stub: { at: number; len: number };
} {
  const lhs = lead;
  const rhs = lhs + PLACEHOLDER.length + 1 + rel.length + 1;
  const stub =
    rhs + PLACEHOLDER.length + " := ".length + (STUB.length - STUB_TACTIC.length);
  return {
    lhs: { at: lhs, len: PLACEHOLDER.length },
    rhs: { at: rhs, len: PLACEHOLDER.length },
    stub: { at: stub, len: STUB_TACTIC.length },
  };
}

export function calcOpenSlots(rel: string) {
  return calcLinkSlots(rel, CALC_KW.length);
}

export function calcEdit(spec: AddSpec, text: string): DocEdit | null {
  if (spec.kind === "calc-first" && spec.chain) {
    const at = { line: spec.chain.lastLink.line, character: 1e5 };
    const pad = " ".repeat(spec.chain.indent);
    const rel = spec.rel ?? "=";
    const lead = 1 + pad.length;
    const slots = calcLinkSlots(rel, lead);
    return {
      range: { start: at, end: at },
      newText: `\n${pad}${calcLinkText(rel)}`,
      fillNth: 1,
      stages: { lhs: slots.lhs, rhs: slots.rhs },
    };
  }
  if (spec.kind === "calc-append" && spec.chain) {
    const bare = spec.chain.firstBare;
    const at = bare
      ? { ...spec.chain.lastLink }
      : { line: spec.chain.lastLink.line, character: 1e5 };
    const head = bare ? ` := ${STUB}` : "";
    const pad = " ".repeat(spec.chain.indent);

    const rhs = text.trim() === "" ? "_" : text.trim();
    const newText = head + `\n${pad}_ ${spec.rel} ${rhs} := ${STUB}`;
    return {
      range: { start: at, end: at },
      newText,

      fillNth: bare ? 2 : 1,
    };
  }
  const h = spec.hole;
  if (!h) return null;

  const inner = " ".repeat(h.ownerStart.character + 2);
  const body = text
    .split("\n")
    .map((l, i) => (i === 0 ? l : inner + l))
    .join("\n");

  if (spec.kind === "hole")
    return {
      range: { start: h.start, end: h.stop },
      newText: `by ${dedupLeadingBy(body)}`,
    };
  const at = { line: h.ownerStart.line, character: 0 };
  return {
    range: { start: at, end: at },
    newText: `${" ".repeat(h.ownerStart.character)}_ ${spec.rel ?? "="} ${
      body.trim() === "" ? "_" : body.trim()
    } := ${STUB}\n`,
    fillNth: 1,
  };
}
