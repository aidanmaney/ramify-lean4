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
// `{id, result}`. Threads need cross-origin isolation (COOP/COEP). A server
// that sends the headers (serve-playground.mjs) gives it at once; a static host
// (GitHub Pages) cannot, so on the reader's ask the page installs a service
// worker that adds them (`web/public/coi-sw.js`) and reloads once
// (`isolateAndReload`); without either the tier says so instead of trying.
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
      this.set({ kind: "failed", why: NOT_ISOLATED });
      return;
    }
    this.set({ kind: "loading", step: "starting" });
    // A worker made from a URL is held to ITS OWN response's headers, and a
    // static host's carry no COEP (and the assets live outside the service
    // worker's scope): a blob that imports the script inherits this page's
    // isolation instead. The script's own fetches are same-origin.
    // `?v=<manifest version>`: a static host lets the browser cache scripts
    // (Pages: 10 min), and an old worker.js against a new engine failed start-up
    // Messages that arrive while the manifest is fetched are queued, then
    // handed to worker.js's own handler once it has loaded.
    const src = `const q = []; self.onmessage = (e) => q.push(e); fetch(${JSON.stringify(`${this.base}manifest.json`)}, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((m) => { self.LIVE_VERSION = m && m.version ? String(m.version) : ""; importScripts(${JSON.stringify(`${this.base}worker.js`)} + (self.LIVE_VERSION ? "?v=" + self.LIVE_VERSION : "")); for (const e of q) self.onmessage(e); }).catch((e) => postMessage({ failed: String(e && e.message || e) }));`;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
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

  /** A step shown before the worker exists (installing the isolation). */
  preparing(step: string): void {
    this.set({ kind: "loading", step });
  }

  /** Live Lean cannot run in this tab, and why — in the reader's words. */
  refuse(why: string): void {
    this.set({ kind: "failed", why });
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

const NOT_ISOLATED = "this tab is not cross-origin isolated, which live Lean's threads need";

/** Where the page reads the live tier's base: `publish.mjs --live-base URL`
 writes `<meta name="ramify-live-base">` into playground.html; `?live=` wins
 (a dev server); else `live/` (serve-playground's layout). An empty value is
 "no live tier". */
export function liveBase(query: URLSearchParams): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="ramify-live-base"]');
  const b = query.get("live") ?? meta?.content ?? "live/";
  return b.trim() === "" ? null : b;
}

/** A desktop browser that can be isolated: already (COOP/COEP from the server)
 or by the service worker. A phone is never offered the download. */
export function liveRunnable(): boolean {
  if (globalThis.crossOriginIsolated) return true;
  let phone = false;
  try {
    phone = window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches;
  } catch {
    /* no matchMedia: not a phone we can tell */
  }
  return !phone && "serviceWorker" in navigator && window.isSecureContext;
}

/** Why live Lean cannot run on this page, in the reader's words — or null
 where it can, or on a phone (phones are out of scope and stay silent). A
 browser with service workers off (Firefox's private windows; hardened
 setups) would otherwise just lose the offer, with nothing saying why. */
export function liveBlockedReason(): string | null {
  if (globalThis.crossOriginIsolated) return null;
  try {
    if (window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches) return null;
  } catch {
    /* not a phone we can tell */
  }
  if (!window.isSecureContext) return "Real Lean needs a secure (https) page.";
  if (!("serviceWorker" in navigator))
    return "Real Lean needs service workers, which this browser has turned off (a private window, or a privacy setting). The answers computed in advance still work.";
  return null;
}

/** The reload `isolateAndReload` makes is marked, so the page that comes back
 starts live Lean by itself (sessionStorage: this tab only). */
const RELOAD_MARK = "ramify.playground.liveIsolate";

/** On load: was this page reloaded to isolate it? Reads and clears the mark. */
export function takeIsolationMark(): boolean {
  try {
    const had = sessionStorage.getItem(RELOAD_MARK) === "1";
    sessionStorage.removeItem(RELOAD_MARK);
    return had;
  } catch {
    return false;
  }
}

/** Install the isolation service worker (`coi-sw.js`, beside the page, so its
 scope covers it) and reload once, marked. Resolves only on failure, with the
 reason in the reader's words. */
export async function isolateAndReload(live: LiveLean, swUrl = "coi-sw.js"): Promise<void> {
  live.preparing("preparing this tab");
  try {
    sessionStorage.setItem(RELOAD_MARK, "1");
  } catch {
    live.refuse("this browser keeps no session storage here (a private window?), which the reload that turns live Lean on needs");
    return;
  }
  try {
    await navigator.serviceWorker.register(swUrl);
    await navigator.serviceWorker.ready;
  } catch {
    try {
      sessionStorage.removeItem(RELOAD_MARK);
    } catch {
      /* nothing to clear */
    }
    live.refuse(
      "this browser would not let the page install the small service worker live Lean needs (a private window often blocks it)",
    );
    return;
  }
  location.reload();
}

/** The reload came back and the page is still not isolated (the service worker
 did not take the page, or the browser ignores the headers it adds). */
export const STILL_NOT_ISOLATED =
  "the page came back without cross-origin isolation, which live Lean's threads need — this browser may not allow it here";

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
