// THE LIVE TIER — real Lean, compiled to WebAssembly, in a Web Worker.
//
// The baked table (playgroundAnswer.ts) answers what was computed in advance.
// This engine answers the rest: `lean/PlaygroundLive.lean` (the same stepping
// code the baker runs) compiled to wasm (`scripts/wasm/`, docs/wasm-spike.md),
// loaded only when the reader asks for it — it is a large download — and
// slotted AFTER the baked engine behind `makeAnswer`, so a baked answer is
// never asked of it and a goal it leaves that the bake knows joins the graph.
//
// The worker (`live/worker.js`) speaks two messages: `{init}` → `{ready}` once
// the wasm runtime is up and `Init` is imported, and `{id, answer: request}` →
// `{id, result}`. Threads need cross-origin isolation (COOP/COEP headers);
// without it the tier says so instead of trying.
import {
  NOT_BAKED,
  goalKey,
  type BakedGoal,
  type BakedState,
  type Engine,
  type Table,
} from "./playgroundAnswer";
import type { TaggedText } from "./taggedText";
import type { BakedPopup, BakedTag } from "./viewerPayload";

export type LiveStatus =
  | { kind: "off" }
  | { kind: "loading"; step: string; done?: number; total?: number }
  | { kind: "ready"; ms: number }
  | { kind: "failed"; why: string };

/** The engine's answer (`Playground.answer`, PlaygroundLive.lean). */
type LiveHints = { hints: string[]; ms: number } | { error: string; ms: number };

type LiveResult =
  | {
      goals: { key: string; goal: BakedGoal; kinds: string[] }[];
      uses: string[];
      /** This answer's popups; the goals' tags index them from 0. */
      popups?: BakedPopup[];
      ms: number;
    }
  | { error: string; ms: number };

export interface LiveRequest {
  file: string;
  theorem: string;
  path: ReadonlyArray<readonly [string, number]>;
  tactic: string;
}

/** One worker = one Lean. Created on the reader's click, kept for the page. */
export class LiveLean {
  status: LiveStatus = { kind: "off" };
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, (r: LiveResult) => void>();
  private listeners = new Set<(s: LiveStatus) => void>();

  private readonly base: string;

  constructor(base: string) {
    // absolute: the worker resolves URLs against ITS location, not the page's
    this.base = new URL(base, location.href).href;
  }

  subscribe(f: (s: LiveStatus) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private set(s: LiveStatus) {
    this.status = s;
    for (const f of this.listeners) f(s);
  }

  get ready(): boolean {
    return this.status.kind === "ready";
  }

  start(): void {
    if (this.worker || this.status.kind === "ready") return;
    if (!globalThis.crossOriginIsolated) {
      this.set({
        kind: "failed",
        why: "this page is not cross-origin isolated, which live Lean's threads need — serve it with COOP/COEP headers",
      });
      return;
    }
    this.set({ kind: "loading", step: "starting" });
    const w = new Worker(`${this.base}worker.js`);
    this.worker = w;
    w.onmessage = ({ data }) => {
      if (data.progress) this.set({ kind: "loading", ...data.progress });
      else if (data.ready) this.set({ kind: "ready", ms: data.ready.ms });
      else if (data.failed) this.fail(data.failed);
      else if (data.id) {
        const k = this.pending.get(data.id);
        this.pending.delete(data.id);
        k?.(data.result);
      }
    };
    w.onerror = (e) => this.fail(e.message || "the worker stopped");
    w.postMessage({ init: { base: this.base } });
  }

  /** Stop Lean and free its memory; the next `start` loads it again (from
   the cache). Questions in flight get an error. */
  stop(): void {
    for (const k of this.pending.values()) k({ error: "live Lean is not running", ms: 0 });
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.set({ kind: "off" });
  }

  private fail(why: string) {
    this.set({ kind: "failed", why });
    for (const k of this.pending.values()) k({ error: `live Lean stopped: ${why}`, ms: 0 });
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  /** The candidates that SUCCEED on a goal (the baker's own list, run live). */
  hints(req: Omit<LiveRequest, "tactic">): Promise<LiveHints> {
    return this.ask({ ...req, hints: true }) as Promise<LiveHints>;
  }

  answer(req: LiveRequest): Promise<LiveResult> {
    return this.ask(req) as Promise<LiveResult>;
  }

  private ask(req: object): Promise<LiveResult | LiveHints> {
    const w = this.worker;
    if (!w || !this.ready) return Promise.resolve({ error: "live Lean is not running", ms: 0 });
    const id = this.next++;
    return new Promise((ok) => {
      this.pending.set(id, ok as (r: LiveResult) => void);
      w.postMessage({ id, answer: JSON.stringify(req) });
    });
  }
}

type Code = TaggedText<BakedTag>;
const rebase = (c: Code, base: number): Code =>
  "text" in c
    ? c
    : "append" in c
      ? { append: c.append.map((x) => rebase(x, base)) }
      : { tag: [{ ...c.tag[0], h: c.tag[0].h + base }, rebase(c.tag[1], base)] };
/** A live goal's popup indices, moved past the table's own. */
function rebaseGoal(g: BakedGoal, base: number): BakedGoal {
  if (base === 0) return g;
  return {
    ...g,
    type: rebase(g.type, base),
    hyps: g.hyps.map((h) => ({ ...h, type: rebase(h.type, base), ...(h.val ? { val: rebase(h.val, base) } : {}) })),
  };
}

/** Live hints for one state of a table, or [] (not running, no route). */
export async function liveHints(t: Table, live: LiveLean, state: number): Promise<string[]> {
  const path = t.paths.get(state);
  const file = t.bake.source;
  if (!live.ready || path === undefined || file === undefined) return [];
  const r = await live.hints({ file, theorem: t.bake.theorem, path });
  return "hints" in r ? r.hints : [];
}

/** The engine's own failures (it could not rebuild the goal from its route,
 or the theorem file did not elaborate) are not Lean's answer to the tactic:
 say so plainly, keep the detail after a dash. Lean's own errors pass through. */
export function readerError(e: string): string {
  if (e.startsWith("path: "))
    return `Live Lean could not rebuild this goal from the steps above it — ${e.slice(6).split("\n")[0]}`;
  if (e.startsWith("no theorem "))
    return `Live Lean could not load this theorem's file — ${e.split("\n")[0]}`;
  if (e.startsWith("live Lean stopped:") || e === "live Lean is not running") return `${e[0].toUpperCase()}${e.slice(1)}`;
  return e;
}

/** The live engine over one theorem's table: the goal's route from the root
 (`Table.paths`) is replayed by the wasm Lean, then the tactic runs. Goals
 come back in full (`states`) so the table can grow; they are keyed by the
 page's own `goalKey`, the key the baked states carry. */
export function liveEngine(t: Table, live: LiveLean): Engine {
  return async (key, tactic) => {
    const id = t.byKey.get(key);
    const path = id === undefined ? undefined : t.paths.get(id);
    const file = t.bake.source;
    if (!live.ready || path === undefined || file === undefined) return NOT_BAKED;
    const r = await live.answer({ file, theorem: t.bake.theorem, path, tactic });
    if ("error" in r) return { error: readerError(r.error) };
    // the answer's popups join the table's, and its tags are re-based onto them
    const base = t.bake.hovers.length;
    t.bake.hovers.push(...(r.popups ?? []));
    const states: BakedState[] = r.goals.map((g) => ({ goal: rebaseGoal(g.goal, base), kinds: g.kinds }));
    return { goals: states.map((s) => goalKey(s.goal)), uses: r.uses, states };
  };
}
