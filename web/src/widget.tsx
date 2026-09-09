import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContext,
  useRpcSession,
  useAsyncPersistent,
  useServerNotificationEffect,
  mapRpcError,
  type PanelWidgetProps,
} from "@leanprover/infoview";
import {
  stableProofOf,
  type Proof,
  type ProofStepPosition,
  type TacticSlot,
} from "./paperproof";
import type { AddResult, AddSpec, DeleteSpec, TextSlot } from "./types";
import { DEFAULT_ABBREV, type AbbrevConfig } from "./abbreviation";
import { calcEdit, fillRange, offsetToPosition } from "./calcEdit";
import { deleteEdit } from "./deleteEdit";
import {
  filterDiagnostics,
  proofSpan,
  type RawDiagnostic,
  type TreeDiagnostic,
} from "./diagnostics";
import { goalAnnotations, type GoalAnnotation } from "./lensGoals";
import { posLE } from "./proofToTree";
import ProofTreeView from "./ProofTreeView";
import type { HypMarkStyle } from "./theme";
import {
  injectStyleOnce,
  makeTaggedRenderers,
  type TaggedGoalEntry,
} from "./taggedRender";
import { taggedSubterms } from "./taggedText";
import { observeThemeChange } from "./theme";
import {
  makeTacticRenderer,
  renderTacticTokens,
  type LabelToken,
  type TacticToken,
  type TacticTokenInfo,
} from "./tacticTokens";

const HOVER_DWELL_MS = 180;

const DOC_SETTLE_MS = 120;

const DEFAULT_TYPING_HOLD_MS = 600;

const TYPING_HOLD_MAX_MS = 5000;

const EXPECT_EDIT_WINDOW_MS = 3000;

const ORIGIN = { line: 0, character: 0 };

function cursorInDecl(
  decl: ProofStepPosition | undefined,
  p: { line: number; character: number },
): boolean {
  if (!decl) return false;
  return posLE(decl.start, p) && posLE(p, decl.stop);
}

const SECTION_ORDER_CSS = `
  div:has(> [data-ptw-root]),
  div:has(> details > [data-ptw-root]) {
    display: flex;
    flex-direction: column;
  }
  div:has(> [data-ptw-root]) > *,
  div:has(> details > [data-ptw-root]) > * {
    order: 1;
  }
  div:has(> [data-ptw-root]) > [data-ptw-root],
  div:has(> details > [data-ptw-root]) > details:has(> [data-ptw-root]) {
    order: 0;
    /* And it does not YIELD. The two rules above make the host's container a
       flex column purely to reorder it, and a flex item's default
       flex-shrink of 1 then lets the tree be squeezed by whatever else the
       card is carrying. Today that is inert (the container's height is
       content-based, so there is nothing to shrink against) and it stops
       being inert the moment any ancestor gains a definite height — a change
       in the host we would not see coming, whose symptom is exactly the
       reported one: the frame ending well above the fold with the sections
       below it taking the room. Pinning the flex costs nothing and removes
       the mechanism. */
    flex: 0 0 auto;
  }
  details:has(> [data-ptw-root]) > summary {
    display: none;
  }
`;

function useSectionOrderCss() {
  useEffect(() => {
    injectStyleOnce("ptw-section-order", SECTION_ORDER_CSS);
  }, []);
}

const MIN_FRAME_PX = 240;

// THE FRAME TAKES ALL THE ROOM THERE IS: `max(MIN_FRAME_PX, 100vh - offset)`,
// with no fraction and no bottom clearance. Both are gone, and each for its
// own reason. The FRACTION (0.9) was a preference for how tall the panel sat,
// and with the tree flowing UNDER the bar rather than reserving room for it,
// it was only ever spending height nothing needed. The CLEARANCE (44px) kept
// the frame's bottom out of the lane the infoview's own fixed "Restart File"
// button owns — but it cost 44px of tree at every panel size to keep two
// pieces of our own chrome off one button. The chrome now dodges that button
// by PLACEMENT instead (ProofTreeView's LANE_* constants: the status card
// sits IN the lane at the button's own inset and height and stops short of
// its width, and the zoom rail moved up above it), which buys the whole 44px
// back for the tree.

/** How far down the VIEWPORT the widget's own root sits — the number the frame
height is `100vh` minus.

It must be the root's top in VIEWPORT coordinates, and that is the whole of the
fix here: it used to add `window.scrollY`, i.e. it reported the root's position
in the DOCUMENT. The two agree only at scroll 0 and only while the widget is
the last thing measured. In the real infoview neither holds — the blocks above
the tree (tactic state, messages, a term goal) grow and shrink on every cursor
move, and the page scrolls — so `100vh - documentTop` was an offset for a
layout the panel no longer had, and it can overshoot the fold in both
directions: below it (the frame's bottom, and with it the status card, ends up
under the "Restart File" lane) or short of it.

The listeners follow from the same fact. A ResizeObserver on `document.body`
sees nothing when a section above changes height inside a body of fixed height,
and `window`'s own `scroll` event never fires for an INNER scroller — so the
scroll listener is registered in the CAPTURE phase, where every scroll in the
document passes through, and a no-dep layout effect re-measures after every
render (one `getBoundingClientRect`, and the widget re-renders on each payload
and cursor move — exactly when the blocks above it have moved).

1px of hysteresis keeps that from looping. The height stays a CSS `calc` over
`100vh` rather than a resolved pixel number: a webview hidden while the panel
is resized fires neither observer nor handler, and a px height would stay wrong
until something else moved, while `100vh` is live whatever we know.

THE HOST IMPOSES NO CAP — read off the shipped bundle rather than assumed, on a
report of the frame ending well above the fold. `InfoDisplayContent` renders a
panel widget through `PanelWidgetDisplay`/`DynamicComponent`, neither of which
adds a DOM element, so the whole chain above `[data-ptw-root]` is
`div.ma1 > details[open] > div.ml1` (plus a `<details>` of the host's own only
when the widget carries a `name`, which a ProofWidgets Component never does).
Every one of those is an auto-height block box with no `height`, `max-height`,
`overflow` or `flex`; the infoview's stylesheet has no `.infoview` selector at
all, its only `max-height` is the tooltip's (set from JS by floating-ui), and
`html, body { height: 100% }` clips nothing because neither sets `overflow`.
So there is no host rule to override from `useSectionOrderCss`.

What that leaves is SHRINK, and the one flex container in the chain is OURS
(the section-order rule) — hence `flex: 0 0 auto` there and a `min-height`
beside the height on the frame itself. A `min-height` is not a hypothetical
size: nothing can shrink it, and `overflow: hidden` on the frame would
otherwise let its automatic minimum size fall to 0. Neither was reproducible
outside VS Code, so both are the mechanism removed rather than a measured bug
fixed; if a short frame survives them, the remaining suspect is the user's own
`lean4.infoViewStyle` CSS, which the host concatenates into the webview's
stylesheet verbatim. */
function useFrameOffset(): {
  rootRef: React.RefObject<HTMLDivElement | null>;
  offset: number;
} {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const measure = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (el.getClientRects().length === 0) return;
    if (el.checkVisibility && !el.checkVisibility()) return;

    const top = el.getBoundingClientRect().top;
    setOffset((prev) => (Math.abs(prev - top) > 1 ? top : prev));
  }, []);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    if (el.parentElement) ro.observe(el.parentElement);
    window.addEventListener("resize", measure);
    // Capture: an ancestor's scroll never reaches `window` in the bubble
    // phase, and the infoview's own scroller is one.
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);
  useLayoutEffect(measure);
  return { rootRef, offset };
}

interface TacticEditEntry {
  stepStart: { line: number; character: number };
  start: { line: number; character: number };
  stop: { line: number; character: number };
  text: string;

  tokens?: TacticToken[];

  labelTokens?: LabelToken[];

  tacticIndent?: number;
}

type ProofTreeData = Proof & {
  taggedGoals?: TaggedGoalEntry[];
  tacticEdits?: TacticEditEntry[];
  tokenInfos?: TacticTokenInfo[];

  diagnostics?: RawDiagnostic[];

  declHeader?: string;
  declHeaderTokens?: TacticToken[];
  declHeaderStart?: { line: number; character: number };

  cfDraft?: string;

  cfDraftCol?: number;

  cfDraftTokens?: TacticToken[];

  cfDraftInfos?: TacticTokenInfo[];

  cfPending?: boolean;
};

interface Settings {
  colors?: Record<string, string>;
  brackets: boolean;
  outline: boolean;
  linkTint: boolean;
  linkMarks: boolean;
  typingHoldMs: number;
  counterfactual: boolean;
  hypMarkStyle: HypMarkStyle;
  abbrev: AbbrevConfig;
}

const DEFAULT_SETTINGS: Settings = {
  brackets: false,
  outline: false,
  linkTint: false,
  linkMarks: false,
  typingHoldMs: DEFAULT_TYPING_HOLD_MS,
  counterfactual: true,
  hypMarkStyle: "highlight",
  abbrev: DEFAULT_ABBREV,
};

interface ThemeColorsResponse {
  brackets?: boolean;
  outline?: boolean;
  linkTint?: boolean;
  linkMarks?: boolean;
  hypMarkStyle?: string;
  typingHoldMs?: number;
  counterfactual?: boolean;
  input?: {
    enabled: boolean;
    leader: string;
    eager: boolean;
    custom: { abbreviation: string; symbol: string }[];
  };
  colors?: { type: string; color: string }[];
}

function parseSettings(r: ThemeColorsResponse, prev: Settings): Settings {
  return {
    colors: r.colors?.length
      ? Object.fromEntries(r.colors.map((c) => [c.type, c.color]))
      : prev.colors,
    brackets: !!r.brackets,
    outline: !!r.outline,
    linkTint: !!r.linkTint,
    linkMarks: r.linkMarks === true,
    typingHoldMs:
      typeof r.typingHoldMs === "number" && isFinite(r.typingHoldMs)
        ? Math.max(0, Math.min(Math.round(r.typingHoldMs), TYPING_HOLD_MAX_MS))
        : DEFAULT_TYPING_HOLD_MS,
    counterfactual: r.counterfactual !== false,
    hypMarkStyle: r.hypMarkStyle === "underline" ? "underline" : "highlight",
    abbrev: r.input
      ? {
          enabled: r.input.enabled !== false,
          leader: r.input.leader || DEFAULT_ABBREV.leader,
          eager: r.input.eager !== false,
          custom: Object.fromEntries(
            (r.input.custom ?? []).map((c) => [c.abbreviation, c.symbol]),
          ),
        }
      : prev.abbrev,
  };
}

// Settings ride the companion's theme file; refetched on theme change, focus and `tick`.
function useSettings(rs: ReturnType<typeof useRpcSession>, tick: number): Settings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let live = true;
    const fetchOnce = () => {
      void rs
        .call<Record<string, never>, ThemeColorsResponse>("ProofTree.themeColors", {})
        .then((r) => {
          if (!live || !r) return;
          setSettings((prev) => {
            const next = parseSettings(r, prev);
            return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
          });
        })
        .catch(() => {});
    };
    fetchOnce();
    const stopObserving = observeThemeChange(() => {
      fetchOnce();
      window.setTimeout(fetchOnce, 400);
    });
    window.addEventListener("focus", fetchOnce);
    return () => {
      live = false;
      stopObserving();
      window.removeEventListener("focus", fetchOnce);
    };
  }, [rs, tick]);
  return settings;
}

export default function ProofTreeWidget(props: PanelWidgetProps) {
  const rs = useRpcSession();
  const ec = useContext(EditorContext);
  const pos = props.pos;
  useSectionOrderCss();
  const { rootRef, offset } = useFrameOffset();

  const [panelOpen, setPanelOpen] = useState(true);

  const [docRev, setDocRev] = useState(0);

  const [pollRev, setPollRev] = useState(0);
  const revTimer = useRef<number | null>(null);
  useServerNotificationEffect<{ uri: string }>(
    "textDocument/publishDiagnostics",
    (params) => {
      if (params.uri !== pos.uri) return;
      if (revTimer.current !== null) window.clearTimeout(revTimer.current);
      revTimer.current = window.setTimeout(() => {
        revTimer.current = null;
        setDocRev((r) => r + 1);
      }, DOC_SETTLE_MS);
    },
    [pos.uri],
  );
  useEffect(
    () => () => {
      if (revTimer.current !== null) window.clearTimeout(revTimer.current);
    },
    [],
  );

  const {
    colors: tokenColors,
    brackets: colorBrackets,
    outline: outlineOnly,
    linkTint,
    linkMarks,
    typingHoldMs,
    counterfactual,
    abbrev,
    hypMarkStyle,
  } = useSettings(rs, docRev);

  const st = useAsyncPersistent<ProofTreeData>(
    () =>
      rs.call<{ pos: typeof pos; cf: boolean }, ProofTreeData>(
        "ProofTree.getProofTree",
        { pos, cf: counterfactual },
      ),
    [rs, pos.uri, pos.line, pos.character, docRev, pollRev, counterfactual],
  );

  const resolved =
    st.state === "resolved" &&
    (st.value.steps.length > 0 || st.value.openBlock !== undefined)
      ? st.value
      : null;

  const incoming = useMemo(() => {
    if (!resolved) return null;
    const proof = stableProofOf(resolved);
    return { proof, sig: JSON.stringify(proof) };
  }, [resolved]);
  const [stable, setStable] = useState<{
    sig: string;
    proof: Proof;
    tacticEdits: TacticEditEntry[];
    deleteSlots: TacticSlot[];
  } | null>(null);

  const candidate = useMemo(
    () =>
      resolved && incoming
        ? {
            sig: incoming.sig,

            proof: { ...incoming.proof, tacticNames: resolved.tacticNames },

            tacticEdits: resolved.tacticEdits ?? [],

            deleteSlots: resolved.deleteSlots ?? [],
          }
        : null,
    [resolved, incoming],
  );

  const expectEditRef = useRef(0);

  const lastActivityRef = useRef(0);
  const posKey = `${pos.uri}:${pos.line}:${pos.character}`;
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [posKey]);

  const navigated =
    !!stable &&
    !!candidate &&
    candidate.proof.proofId !== stable.proof.proofId &&
    !cursorInDecl(stable.proof.declRange, pos);

  const swapPending = !!(candidate && stable && candidate.sig !== stable.sig);

  if (
    candidate &&
    (!stable || (swapPending && (typingHoldMs <= 0 || navigated)))
  ) {
    setStable(candidate);
  }

  const candidateRef = useRef<typeof candidate>(null);
  useEffect(() => {
    candidateRef.current = candidate;
  });
  const candSig = candidate?.sig ?? null;
  useEffect(() => {
    if (candSig === null || !stable) return;
    if (stable.sig === candSig) return;

    if (typingHoldMs <= 0 || navigated) return;
    const swap = () => {
      const c = candidateRef.current;
      if (c && c.sig === candSig) setStable(c);
    };
    if (Date.now() < expectEditRef.current) {
      swap();
      return;
    }
    let timer: number | null = null;
    const arm = () => {
      const wait = lastActivityRef.current + typingHoldMs - Date.now();
      if (wait <= 0) {
        swap();
        return;
      }
      timer = window.setTimeout(arm, wait);
    };
    arm();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [candSig, navigated, stable, typingHoldMs]);

  const cfDraft = st.state === "resolved" ? st.value.cfDraft : undefined;

  const cfDraftCol = st.state === "resolved" ? st.value.cfDraftCol : undefined;

  const cfDraftTokens =
    st.state === "resolved" ? st.value.cfDraftTokens : undefined;
  const cfDraftInfos =
    st.state === "resolved" ? st.value.cfDraftInfos : undefined;

  useEffect(() => {
    if (!(st.state === "resolved" && st.value.cfPending)) return;
    const t = window.setTimeout(() => setPollRev((r) => r + 1), 800);
    return () => window.clearTimeout(t);
  }, [st]);

  const [interactive, setInteractive] = useState<ProofTreeData | null>(null);

  if (resolved && interactive !== resolved && !swapPending) {
    setInteractive(resolved);
  } else if (st.state === "rejected" && interactive !== null) {
    setInteractive(null);
  }

  const renderers = useMemo(
    () =>
      stable
        ? makeTaggedRenderers(stable.proof, interactive?.taggedGoals ?? [])
        : null,
    [stable, interactive],
  );

  const diagnostics: TreeDiagnostic[] = useMemo(
    () =>
      stable
        ? filterDiagnostics(
            interactive?.diagnostics ?? [],
            proofSpan(stable.proof),
          ).kept
        : [],
    [interactive, stable],
  );

  const fetchGlobalNames = useMemo(
    () => (query: string) =>
      rs.call<{ pos: typeof pos; query: string }, string[]>(
        "ProofTree.completionNames",
        { pos, query },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rs, pos.uri],
  );

  const getGoalTerms = useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const { goalId, goal } of interactive?.taggedGoals ?? []) {
      const terms = taggedSubterms(goal.type);
      for (const h of goal.hyps) terms.push(...taggedSubterms(h.type));
      byId.set(goalId, terms);
    }
    return (goalId: string): string[] => byId.get(goalId) ?? [];
  }, [interactive]);

  const [relayError, setRelayError] = useState<string | null>(null);
  const callCompanion = (
    action: string,
    p: ProofStepPosition,
    annotations: GoalAnnotation[] = [],
  ) => {
    rs.call("ProofTree.popoutEdit", {
      uri: pos.uri,
      start: p.start,
      stop: p.stop,
      action,
      annotations,
    }).then(
      () => setRelayError(null),
      (e: unknown) => {
        console.error(`[proof-tree] ${action} RPC failed:`, e);

        setRelayError(`${action} failed: ${mapRpcError(e).message}`);
      },
    );
  };

  const editByStart = useMemo(
    () =>
      new Map(
        (stable?.tacticEdits ?? []).map((e): [string, TacticEditEntry] => [
          `${(e.stepStart ?? e.start).line}:${(e.stepStart ?? e.start).character}`,
          e,
        ]),
      ),
    [stable],
  );
  const getTacticEdit = (p: ProofStepPosition) => {
    const e = editByStart.get(`${p.start.line}:${p.start.character}`);
    return e ? { pos: { start: e.start, stop: e.stop }, text: e.text } : null;
  };

  const infoAt = useMemo(
    () =>
      new Map(
        (interactive?.tokenInfos ?? []).map((i): [string, TacticTokenInfo] => [
          `${i.start.line}:${i.start.character}`,
          i,
        ]),
      ),
    [interactive],
  );

  const renderTaggedTactic = useMemo(
    () =>
      makeTacticRenderer(
        (p) => editByStart.get(`${p.start.line}:${p.start.character}`),
        infoAt,
        colorBrackets,
      ),
    [editByStart, infoAt, colorBrackets],
  );

  const renderCfDraft = useMemo(() => {
    const toks = cfDraftTokens;
    if (!toks || toks.length === 0) return undefined;
    const infos = new Map<string, TacticTokenInfo>();
    for (const i of cfDraftInfos ?? [])
      infos.set(`${i.start.line}:${i.start.character}`, i);
    return (draft: string, line: number, col: number) =>
      renderTacticTokens(
        draft,
        { line, character: col },
        toks,
        draft,
        [draft],
        infos,
        undefined,
        colorBrackets,
      );
  }, [cfDraftTokens, cfDraftInfos, colorBrackets]);

  const declHeader = stable?.proof.declHeader ?? "";
  const declHeaderStart = stable?.proof.declHeaderStart;
  const renderDeclHeader = useMemo(() => {
    const toks = stable?.proof.declHeaderTokens;
    const start = stable?.proof.declHeaderStart;
    const text = stable?.proof.declHeader ?? "";
    if (!toks || toks.length === 0 || !start || text === "") return undefined;

    return (lines: string[], label?: string) =>
      renderTacticTokens(
        text,
        start,
        toks,
        label ?? text,
        lines,
        infoAt,
        undefined,
        colorBrackets,
      );
  }, [stable, infoAt, colorBrackets]);

  const expectOwnEdit = () => {
    expectEditRef.current = Date.now() + EXPECT_EDIT_WINDOW_MS;
  };

  const applyDocEdit = (
    start: { line: number; character: number },
    end: { line: number; character: number },
    newText: string,
  ) => {
    expectOwnEdit();
    void ec.api.applyEdit({
      changes: { [pos.uri]: [{ range: { start, end }, newText }] },
    });
  };

  const editTactic = (p: ProofStepPosition, newText: string) =>
    applyDocEdit(p.start, p.stop, newText);

  const addTactic = (
    spec: AddSpec,
    text: string,
    slots?: { lhs: TextSlot; rhs: TextSlot },
  ): AddResult => {
    const at2 = (p: { line: number; character: number }) =>
      editByStart.get(`${p.line}:${p.character}`);

    const calc = calcEdit(spec, text);
    if (calc) {
      applyDocEdit(calc.range.start, calc.range.end, calc.newText);

      const to = (s: TextSlot) =>
        offsetToPosition(calc.range.start, calc.newText, s.at, s.len);
      return {
        fill: calc.fillNth
          ? fillRange(calc.range.start, calc.newText, calc.fillNth)
          : null,
        stages: calc.stages
          ? { lhs: to(calc.stages.lhs), rhs: to(calc.stages.rhs) }
          : undefined,
      };
    }
    const e = at2(spec.after.start);
    const stop = e?.stop ?? spec.after.stop;
    const at = { line: stop.line, character: 1e5 };

    const cols = at2(spec.producer.start)?.tacticIndent ?? spec.indent;
    const indent = " ".repeat(cols);
    const prefix =
      spec.kind === "bullet"
        ? "· "
        : spec.kind === "case"
          ? `| ${spec.caseName ?? "_"} => `
          : "";

    const inner = " ".repeat(indent.length + prefix.length + 2);
    const body = text
      .split("\n")
      .map((l, i) => (i === 0 ? indent + prefix + l : inner + l))
      .join("\n");
    const newText = "\n" + body;
    applyDocEdit(at, at, newText);

    const start = { line: at.line, character: 0 };

    const lead = 1 + indent.length + prefix.length;
    const to = (s: TextSlot) =>
      offsetToPosition(start, newText, s.at + lead, s.len);
    return {
      fill: text === "sorry" ? null : fillRange(start, newText, 1),
      stages: slots ? { lhs: to(slots.lhs), rhs: to(slots.rhs) } : undefined,
    };
  };

  const deleteTactic = (spec: DeleteSpec) => {
    const e = deleteEdit(spec, stable?.deleteSlots ?? []);
    if (!e) return;
    applyDocEdit(e.range.start, e.range.end, e.newText);
  };

  const previewRange = (r: ProofStepPosition | null) => {
    if (r) callCompanion("preview", r);
    else callCompanion("preview-clear", { start: ORIGIN, stop: ORIGIN });
  };

  const undo = (redo: boolean) => {
    expectOwnEdit();
    callCompanion(redo ? "redo" : "undo", { start: ORIGIN, stop: ORIGIN });
  };

  const hoverTimer = useRef<number | null>(null);
  const highlighted = useRef(false);
  const hoverTactic = (p: ProofStepPosition | null) => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (p === null) {
      if (highlighted.current) {
        highlighted.current = false;
        callCompanion("clear", { start: ORIGIN, stop: ORIGIN });
      }
      return;
    }
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      highlighted.current = true;

      callCompanion("highlight", getTacticEdit(p)?.pos ?? p);
    }, HOVER_DWELL_MS);
  };

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const lensGoals = useMemo(() => {
    if (!stable) return [];

    const recovered = new Set(
      (stable.proof.recovered ?? [])
        .filter((r) => r.kind !== "term")
        .map((r) => `${r.start.line}:${r.start.character}`),
    );
    const proof = recovered.size
      ? {
          ...stable.proof,
          steps: stable.proof.steps.filter(
            (s) =>
              !recovered.has(
                `${s.position.start.line}:${s.position.start.character}`,
              ),
          ),
        }
      : stable.proof;
    return goalAnnotations(
      proof,
      (start) => editByStart.get(`${start.line}:${start.character}`)?.stop,
    );
  }, [stable, editByStart]);

  const lensOpened = useRef(false);

  const reveal = (p: ProofStepPosition) =>

    callCompanion("reveal", getTacticEdit(p)?.pos ?? p, lensGoals);

  const popoutEdit = (p: ProofStepPosition) => {
    lensOpened.current = true;
    callCompanion("popout", p, lensGoals);
  };

  useEffect(() => {
    if (!lensOpened.current || lensGoals.length === 0) return;
    callCompanion("annotate", { start: ORIGIN, stop: ORIGIN }, lensGoals);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensGoals]);

  const body = !stable ? (
    <div style={{ fontFamily: "monospace", fontSize: 12, color: "#888", padding: 4 }}>
      {st.state === "rejected"
        ? `Proof tree error: ${mapRpcError(st.error).message}`
        : st.state === "resolved"
          ? "No proof tree here — place the cursor inside a tactic proof."
          : "Loading proof tree…"}
    </div>
  ) : (
    <div ref={rootRef}>

      {relayError && (
        <div
          onClick={() => setRelayError(null)}
          title="click to dismiss"
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            padding: "2px 6px",
            cursor: "pointer",
            color: "var(--vscode-errorForeground, #c53030)",
            background: "var(--vscode-inputValidation-errorBackground, #fff5f5)",
            border:
              "1px solid var(--vscode-inputValidation-errorBorder, #fc8181)",
            borderRadius: 3,
          }}
        >
          Ramify: {relayError}
        </div>
      )}
      <ProofTreeView
        proof={stable.proof}
        onReveal={reveal}
        getTacticEdit={getTacticEdit}
        onEditTactic={editTactic}
        getGoalTerms={getGoalTerms}
        fetchGlobalNames={fetchGlobalNames}
        tokenColors={tokenColors}
        outline={outlineOnly}
        hypMarkStyle={hypMarkStyle}
        linkTint={linkTint}
        linkMarks={linkMarks}
        abbrev={abbrev}
        onPopoutEdit={popoutEdit}
        highlightPos={{ line: pos.line, character: pos.character }}
        declHeader={declHeader}
        renderDeclHeader={renderDeclHeader}
        onRevealHeader={
          declHeaderStart
            ? () =>
                reveal({
                  start: declHeaderStart,
                  stop: declHeaderStart,
                })
            : undefined
        }
        cfStub={
          stable?.proof.cfLine != null
            ? {
                line: stable.proof.cfLine,

                pos: stable.proof.cfStubPos,
                draft: cfDraft ?? "",

                col: cfDraftCol,
                render: renderCfDraft,
              }
            : null
        }

        height={`max(${MIN_FRAME_PX}px, calc(100vh - ${offset}px))`}
        renderTaggedGoal={renderers?.renderTaggedGoal}
        renderTaggedHyps={renderers?.renderTaggedHyps}
        renderTaggedTactic={renderTaggedTactic}
        onAddTactic={addTactic}
        onHoverTactic={hoverTactic}
        deleteSlots={stable?.deleteSlots}
        onDeleteTactic={deleteTactic}
        onPreviewRange={previewRange}
        onUndo={undo}
        diagnostics={diagnostics}
      />
    </div>
  );

  return (
    <div data-ptw-root style={{ marginTop: "0.25rem" }}>
      <details
        open={panelOpen}

        onToggle={(e) => setPanelOpen(e.currentTarget.open)}
      >
        <summary className="mv2 pointer">Proof tree</summary>
        {body}
      </details>
    </div>
  );
}
