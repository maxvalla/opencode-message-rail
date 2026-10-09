/**
 * Root-scoped rail state — docs/design.md §A.4 (state model), §C (tier machine),
 * §D (direct → expand → replay → cold), §E.1–§E.2 (dwell + card), §G.9.
 *
 * Everything below is wrapped so a host-shape change degrades the rail instead
 * of throwing into the host: host reads go through `guard()` (with the §C.4
 * three-strikes/30 s lockout), the probe is cached behind `attachedCheck`, and
 * the only reactive computation is `view` — turns are built by an explicit
 * `rebuild()`, never read inside a tracked/memo computation (§F row 5).
 */

import { createMemo, createSignal } from "solid-js";
import type { Context, Route } from "@opencode-ai/plugin/tui/context";
import type { MouseEvent, Renderable } from "@opentui/core";
import { attachedCheck, findTranscript, measure, type Measure, type TextScroller } from "./probe";
import {
  buildRailRows,
  clamp,
  computeNav,
  hitAt,
  layoutEven,
  layoutRows,
  truncateWrapped,
  type Nav,
  type RailRow,
  type Turn,
} from "./geom";
import { fetchAll, hostUsers, isNavigable, mergeTurns, revertPoint, type FetchState } from "./turns";
import { railColors, type RailColors } from "./theme";

export type Tier = 0 | 1 | 2 | 3;

export interface Card {
  w: number;
  h: number;
  /** Rail-relative Y; the card is a sibling of the rail under the 0×0 host. */
  top: number;
  header: string;
  lines: string[];
}

export interface Geom {
  railTop: number;
  railLeft: number;
  gutter: number;
  height: number;
  sbScreenY: number;
  sbScreenX: number;
  sbWidth: number;
}

export interface View {
  tier: Tier;
  turns: Turn[];
  rows: RailRow[];
  height: number;
  railTop: number;
  railLeft: number;
  gutter: number;
  chev: number;
  windowed: boolean;
  i0: number;
  i1: number;
  nav: Nav;
  card: Card | null;
}

export interface Settings {
  enabled: boolean;
  wheelLines: number;
  dwellMs: number;
}

const POLL_MS = 150;
const POLL_IDLE_MS = 2_000;
const ERR_WINDOW_MS = 10_000;
const REBUILD_DEBOUNCE_MS = 250;
const PROBE_THROTTLE_MS = 500;
const LOCKOUT_MS = 30_000;
const CARD_MIN_W = 28;
const CARD_MAX_W = 56;
const CARD_LINES = 3;

const DEFAULT_SETTINGS: Settings = { enabled: true, wheelLines: 3, dwellMs: 120 };

const EMPTY_NAV: Nav = {
  activeIdx: -1,
  upIndex: null,
  upInferred: false,
  downIndex: null,
  downInferred: false,
  atBottom: false,
};

export interface RailController {
  readonly ctx: Context;
  readonly colors: RailColors;
  view: () => View;
  tier: () => Tier;
  turns: () => Turn[];
  tick: () => void;
  kick: () => void;
  hoverRow: (row: RailRow | null) => void;
  dismissCard: () => void;
  activate: (a: { kind: "up" | "down" | "tick"; turnIdx: number }) => void;
  wheel: (e: MouseEvent) => void;
  jumpTo: (t: Turn) => void;
  debug: () => Record<string, unknown>;
  dispose: () => void;
}

/** §C.2 — the checks that select a raw tier. */
function evaluateTier(route: Route, sb: TextScroller | null, m: Measure | null, turns: Turn[]): Tier {
  if (route.type !== "session") return 0;
  if (!sb || !m || m.stale) return 1;
  if (turns.length === 0) return 2;
  const known = new Set(turns.map((t) => t.id));
  return m.items.some((i) => known.has(i.id)) ? 3 : 2;
}

const numOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function createRail(
  ctx: Context,
  settings: Settings = DEFAULT_SETTINGS,
  toastOnce: (message: string, variant?: "warning" | "error") => void = (message, variant) => {
    try {
      ctx.ui.toast.show({ message, variant: variant ?? "warning" });
    } catch {
      /* never throw into the host */
    }
  },
): RailController {
  // Note: no createRoot here — the caller owns the reactive scope (tui.tsx wraps
  // createRail in createRoot, so the memo below disposes with the plugin).
  const root = ctx.renderer.root as Renderable;
  const colors = railColors(ctx);

  // ---- signals (§A.4) -----------------------------------------------------
  const [tier, setTier] = createSignal<Tier>(0);
  const [turns, setTurns] = createSignal<Turn[]>([], { equals: turnsEq });
  const [sample, setSample] = createSignal<Measure | null>(null, { equals: measureEq });
  const [geom, setGeom] = createSignal<Geom>(
    { railTop: 0, railLeft: 0, gutter: 1, height: 0, sbScreenY: 0, sbScreenX: 0, sbWidth: 0 },
    { equals: geomEq },
  );
  const [hover, setHover] = createSignal<number | null>(null);
  const [card, setCard] = createSignal<Card | null>(null);
  const [jumped, setJumped] = createSignal<number | null>(null);

  // ---- probe cache --------------------------------------------------------
  let sb: TextScroller | null = null;
  let host: Renderable | null = null;
  let probeThrottle = 0;
  let lastStale = false;
  let disposed = false;

  // ---- error budget (§C.4) ------------------------------------------------
  let errors = 0;
  let lastErrAt = 0;
  let lockedUntil = 0;

  function guard<T>(fn: () => T, fallback: T): T {
    try {
      const v = fn();
      errors = 0;
      return v;
    } catch {
      const now = Date.now();
      if (now - lastErrAt > ERR_WINDOW_MS) errors = 0;
      lastErrAt = now;
      if (++errors >= 3) {
        lockedUntil = now + LOCKOUT_MS;
        errors = 0;
        toastOnce("Message rail disabled for 30s after repeated errors");
      }
      return fallback;
    }
  }

  // ---- session helper -----------------------------------------------------
  function currentSid(): string {
    const r = guard(() => ctx.ui.router.current(), { type: "home" } as Route);
    return r && r.type === "session" ? r.sessionID : "";
  }

  function dispatch(id: string) {
    guard(() => ctx.keymap.dispatch(id), undefined);
  }

  // ---- turns (explicit rebuild only) --------------------------------------
  let fetchState: FetchState = { pool: new Map<string, Turn>() };
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFetchedSid = "";

  function rebuild() {
    if (disposed) return;
    const route = guard(() => ctx.ui.router.current(), { type: "home" } as Route);
    if (!route || route.type !== "session") {
      setTurns([]);
      return;
    }
    // Untracked by construction: this runs from timers/promises, never from the memo.
    const next = guard(
      () => mergeTurns(fetchState.pool, hostUsers(ctx, route.sessionID), revertPoint(ctx, route.sessionID)),
      turns(),
    );
    setTurns(next);
  }

  function scheduleRebuild() {
    if (disposed) return;
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
  }

  // ---- probe --------------------------------------------------------------
  let bar: any = null;
  let barHandler: (() => void) | null = null;

  function attachBar(s: TextScroller) {
    if (bar === s && barHandler) return;
    detachBar();
    bar = s;
    barHandler = () => kick();
    try {
      (s as any).verticalScrollBar?.on?.("change", barHandler);
    } catch {
      /* optional hook — the 150 ms poll is the primary path */
    }
  }

  function detachBar() {
    try {
      if (bar && barHandler) bar.verticalScrollBar?.off?.("change", barHandler);
    } catch {
      /* ignore */
    }
    bar = null;
    barHandler = null;
  }

  /** §C.5 — re-probe on detached/stale, throttled; otherwise reuse the cached scrollbox. */
  function ensureSb(): TextScroller | null {
    if (sb && !lastStale && attachedCheck(root, sb)) return sb;
    const now = Date.now();
    if (sb && now < probeThrottle) return sb; // keep the known ref until the throttle expires
    probeThrottle = now + PROBE_THROTTLE_MS;
    detachBar();
    const known = new Set(turns().map((t) => t.id));
    const found = guard(() => findTranscript(root, known), null);
    sb = found?.sb ?? null;
    host = found?.host ?? null;
    lastStale = false;
    if (sb && host) attachBar(sb);
    return sb;
  }

  // ---- geometry (from the probed scrollbox + its parent rect) --------------
  function geomFrom(s: TextScroller): Geom {
    const raw: any = s;
    const sbScreenX = numOr(raw.screenX, numOr(raw.x, 0));
    const sbScreenY = numOr(raw.screenY, numOr(raw.y, 0));
    const sbWidth = Math.max(0, numOr(raw.width, 0));
    const height = Math.max(1, Math.floor(numOr(raw.height, 0)));
    const railLeft = sbScreenX + sbWidth;
    const railTop = sbScreenY;

    // The gutter is the transcript column's right padding. Prefer the parent rect
    // (the fixture's real answer: parent right 178 − sbEnd 176 = 2); fall back to
    // the window's right edge only when the parent rect is unreadable. `renderer.width`
    // is never used to POSITION the rail (design §A.1 item 3), and the 1..3 clamp keeps
    // a wide fallback from painting over a sidebar that sits further right.
    const parent: any = raw.parent ?? null;
    const parentX = numOr(parent?.screenX, NaN);
    const parentWidth = numOr(parent?.width, NaN);
    const parentRight = Number.isFinite(parentX) && Number.isFinite(parentWidth) ? parentX + parentWidth : NaN;
    const rendererWidth = numOr((ctx.renderer as any)?.width, 0);
    const available = Number.isFinite(parentRight) ? parentRight - railLeft : rendererWidth - railLeft;
    const gutter = clamp(available >= 1 ? available : 2, 1, 3);

    return { railTop, railLeft, gutter, height, sbScreenY, sbScreenX, sbWidth };
  }

  // ---- dwell + hover card (§E.1–§E.3) -------------------------------------
  let dwellTimer: ReturnType<typeof setTimeout> | undefined;
  let cardOpen = false;
  let pendingFire: (() => void) | null = null;

  function dismissCard() {
    clearTimeout(dwellTimer);
    pendingFire = null;
    cardOpen = false;
    setCard(null);
    setHover(null);
  }

  function buildCard(v: View, idx: number): Card {
    const t = v.turns[idx];
    const avail = Math.max(CARD_MIN_W, v.railLeft - 2); // the transcript's own width is the budget
    const w = Math.min(CARD_MAX_W, avail);
    const textW = Math.max(8, w - 2); // 1 column padding each side, borderless
    const lines = truncateWrapped(t.text || "(empty)", textW, CARD_LINES);
    const h = 1 + lines.length; // 1 header line
    const k = idx - v.i0;
    const rel = v.chev ? k + 1 : k; // rail-row of the tick (+1 for the top chevron)
    // Rail-relative: the card is rendered inside the rail box, clamped to its bounds.
    const top = clamp(rel - Math.floor(h / 2), 0, Math.max(0, v.height - h));
    const d = new Date(t.created);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return { w, h, top, header: `${hh}:${mm}  #${idx + 1}`, lines };
  }

  function hoverRow(row: RailRow | null) {
    if (!row || row.kind === "blank") {
      clearTimeout(dwellTimer);
      pendingFire = null;
      setHover(null);
      return;
    }
    if (row.kind !== "tick") {
      // Chevrons are not hover targets, and a pending dwell must not fire for a
      // tick the pointer has already left (an open card stays open — §E.1).
      clearTimeout(dwellTimer);
      pendingFire = null;
      setHover(null);
      return;
    }
    const idx = row.turnIdx;
    setHover(idx);
    const fire = () => {
      if (pendingFire !== fire) return; // superseded by a later hover
      if (Date.now() < lockedUntil) return;
      const v = view();
      if (!v.turns[idx]) return;
      cardOpen = true;
      setCard(buildCard(v, idx));
    };
    pendingFire = fire;
    if (cardOpen) {
      fire(); // already open → swap instantly, no re-dwell
      return;
    }
    clearTimeout(dwellTimer);
    dwellTimer = setTimeout(fire, settings.dwellMs);
  }

  // ---- jump engine (§D: direct → expand → replay → cold) -------------------
  let jumpSeq = 0;
  let active: { token: number; ac: AbortController } | null = null;
  let lastToastID = "";
  let lastJumpRung: "direct" | "expand" | "cold" | "replay" | "miss" | null = null;

  function warnOnce(id: string, message: string) {
    if (lastToastID === id) return;
    lastToastID = id;
    toastOnce(message, "warning");
  }

  function jumpTo(t: Turn) {
    active?.ac.abort(); // coalesce — the superseded coroutine unwinds via its own alive() checks
    const st = { token: ++jumpSeq, ac: new AbortController() };
    active = st;
    const sid = currentSid();
    const alive = () => active === st && st.token === jumpSeq && !st.ac.signal.aborted && currentSid() === sid;
    dismissCard();
    const idx = turns().findIndex((x) => x.id === t.id);
    if (idx >= 0) setJumped(idx);
    void jumpImpl(t, alive).finally(() => {
      if (active === st) active = null;
    });
  }

  function hostHas(sid: string, id: string): boolean {
    return hostUsers(ctx, sid).some((m) => m.id === id);
  }

  function nodePresent(id: string): boolean {
    try {
      const found = (root as { findDescendantById?: (key: string) => unknown }).findDescendantById?.(id);
      if (found) return true;
    } catch {
      /* fall through */
    }
    const s = sb;
    if (!s) return false;
    return guard(() => measure(s, new Set([id])).items.some((i) => i.id === id), false);
  }

  async function waitFor(id: string, alive: () => boolean, timeout = 2_000): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!alive()) return false;
      if (nodePresent(id)) return true;
      await frames(1);
    }
    return nodePresent(id);
  }

  async function expandAndScroll(s: TextScroller, id: string, alive: () => boolean): Promise<boolean> {
    dispatch("session.messages_last_user");
    await frames(2);
    if (!alive()) return false;
    if (!(await waitFor(id, alive))) return false;
    await frames(2);
    return scrollToTurn(s, id, alive);
  }

  async function ensureLoaded(sid: string, id: string, alive: () => boolean): Promise<boolean> {
    const M = (ctx.data.session.message as unknown as {
      more?: (sessionID: string) => boolean;
      loading?: (sessionID: string) => boolean;
      loadMore?: (sessionID: string, opts?: { all?: boolean }) => Promise<unknown>;
    });
    if (!M?.more || !M?.loading || !M?.loadMore) return hostHas(sid, id);
    const deadline = Date.now() + 60_000;
    for (let page = 0; page < 400 && Date.now() < deadline; page++) {
      if (!alive()) return false;
      if (hostHas(sid, id)) return true;
      if (M.loading(sid)) {
        await sleep(50);
        continue;
      }
      if (!M.more(sid)) return false;
      try {
        // One page at a time. `{ all: true }` pulled the whole history and
        // exploded scrollHeight (237 → 7977 on the fixture).
        await M.loadMore(sid);
      } catch {
        return false;
      }
    }
    return hostHas(sid, id);
  }

  async function replayTo(t: Turn, alive: () => boolean): Promise<boolean> {
    const sid = currentSid();
    const nav = hostUsers(ctx, sid).filter(isNavigable);
    const idx = nav.findIndex((m) => m.id === t.id);
    if (idx < 0) return false;
    const steps = nav.length - 1 - idx;
    dispatch("session.messages_last_user");
    await frames(2);
    for (let i = 0; i < steps; i++) {
      if (!alive()) return false;
      dispatch("session.message.user.previous");
    }
    await frames(2);
    return true;
  }

  /** §D — direct → expand → replay → cold. Toast only after every rung fails. */
  async function jumpImpl(t: Turn, alive: () => boolean): Promise<void> {
    lastJumpRung = null;
    const s0 = ensureSb();
    if (s0 && (await scrollToTurn(s0, t.id, alive))) {
      lastJumpRung = "direct";
      kick();
      return;
    }
    if (!alive()) return;

    const s1 = ensureSb() ?? s0;
    if (s1 && (await expandAndScroll(s1, t.id, alive))) {
      lastJumpRung = "expand";
      kick();
      return;
    }
    if (!alive()) return;

    // Replay before cold: if the host cache already has the id, paging
    // `{all:true}` is unnecessary and blows the transcript open.
    if (await replayTo(t, alive)) {
      lastJumpRung = "replay";
      kick();
      return;
    }
    if (!alive()) return;

    const sid = currentSid();
    if (sid && !hostHas(sid, t.id)) {
      const loaded = await ensureLoaded(sid, t.id, alive);
      if (!alive()) return;
      if (!loaded) {
        lastJumpRung = "miss";
        warnOnce(t.id, "That message is no longer in this session");
        return;
      }
      lastJumpRung = "cold";
      const s2 = ensureSb() ?? s1;
      if (s2 && (await expandAndScroll(s2, t.id, alive))) {
        kick();
        return;
      }
      if (!alive()) return;
      if (await replayTo(t, alive)) {
        kick();
        return;
      }
      if (!alive()) return;
    }

    lastJumpRung = "miss";
    warnOnce(t.id, "Couldn't reach that message");
  }

  async function scrollToTurn(s: TextScroller, id: string, alive: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt <= 2; attempt++) {
      if (!alive() || !attachedCheck(root, s)) return false;
      const m = measure(s, new Set([id]));
      const it = m.items.find((x) => x.id === id);
      if (!it) {
        if (typeof s.scrollChildIntoView === "function") {
          try {
            (s as { stickyScroll?: boolean }).stickyScroll = false;
            s.scrollChildIntoView(id);
            await frames(2);
            if (!alive()) return false;
            if (nodePresent(id)) return true;
          } catch {
            /* fall through to escalate */
          }
        }
        return false; // culled — caller escalates
      }
      const target = clamp(it.top, 0, m.maxScroll);
      (s as { stickyScroll?: boolean }).stickyScroll = false;
      s.scrollTo(target);
      await frames(2);
      if (!alive()) return false;
      const after = measure(s, new Set([id]));
      const now = after.items.find((x) => x.id === id);
      if (!now) return true; // landed, then culled → success
      const want = clamp(target, 0, after.maxScroll);
      if (Math.abs(after.scrollTop - want) <= 1) return true;
      if (Math.abs(now.top - want) <= 1) return true;
    }
    return false;
  }

  // ---- sampling -----------------------------------------------------------
  let kicked = false;
  function kick() {
    if (kicked || disposed) return;
    kicked = true;
    setTimeout(() => {
      kicked = false;
      if (!disposed) guard(() => tick(), undefined);
    }, 0);
  }

  function tick(): void {
    if (!settings.enabled) {
      setTier(0);
      setSample(null);
      dismissCard();
      return;
    }
    if (Date.now() < lockedUntil) {
      setTier(1);
      setSample(null);
      dismissCard();
      return;
    }

    const route = guard(() => ctx.ui.router.current(), { type: "home" } as Route);
    if (!route || route.type !== "session") {
      setTier(0);
      setSample(null);
      dismissCard();
      return;
    }
    const sid = route.sessionID;

    // Session change → drop the pool and refetch authoritative history.
    if (lastFetchedSid !== sid) {
      lastFetchedSid = sid;
      fetchState = { pool: new Map<string, Turn>() };
      rebuild();
      void fetchAll(ctx, sid, fetchState)
        .then(() => {
          if (!disposed && lastFetchedSid === sid) rebuild();
        })
        .catch(() => undefined);
    }

    const s = ensureSb();
    const known = new Set(turns().map((t) => t.id));
    const m = s ? guard(() => measure(s, known), null) : null;
    lastStale = !m || m.stale;

    const raw = evaluateTier(route, s, m, turns());
    setTier(raw);

    if (!s || !m || raw === 1) {
      setSample(null);
      setGeom((g) => (g.height === 0 ? g : { ...g, height: 0 }));
      return;
    }

    if (sample()?.scrollTop !== m.scrollTop) dismissCard(); // transcript moved → hover card is stale
    setSample(m);
    setGeom((g) => {
      const next = geomFrom(s);
      return geomEq(g, next) ? g : next;
    });
    if (m.atBottom) {
      try {
        (s as { stickyScroll?: boolean }).stickyScroll = true;
      } catch {
        /* optional */
      }
    }
  }

  // ---- view memo (§A.4/§A.5) ----------------------------------------------
  const view = createMemo<View>(() => {
    const m = sample();
    const g = geom();
    const list = turns();
    const t = tier();
    const chev = t > 1 && g.height >= 4 ? 2 : 0;

    const nav: Nav =
      m && list.length
        ? computeNav(list, m.items, m.scrollTop, m.maxScroll, m.atBottom)
        : { ...EMPTY_NAV, atBottom: m?.atBottom ?? false };

    const layout =
      t >= 3
        ? layoutRows(list.length, g.height, chev, nav.activeIdx, nav.atBottom)
        : layoutEven(list.length, g.height, chev);
    const rows = buildRailRows({
      height: g.height,
      chev,
      layout,
      activeIdx: t >= 3 ? nav.activeIdx : -1,
      hoverIdx: hover(),
      jumpedIdx: t >= 3 ? jumped() : null,
      hasUp: nav.upIndex !== null,
      hasDown: nav.downIndex !== null,
    });

    return {
      tier: t,
      turns: list,
      rows,
      height: g.height,
      railTop: g.railTop,
      railLeft: g.railLeft,
      gutter: g.gutter,
      chev,
      windowed: layout.windowed,
      i0: layout.i0,
      i1: layout.i1,
      nav,
      card: card(),
    };
  });

  // ---- lifecycle ----------------------------------------------------------
  const onResize = () => {
    detachBar();
    sb = null;
    host = null;
    lastStale = true;
    kick();
  };
  guard(() => ctx.renderer.on("resize", onResize), undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  (function loop() {
    if (disposed) return;
    const wait = tier() >= 2 ? POLL_MS : POLL_IDLE_MS;
    timer = setTimeout(() => {
      if (disposed) return;
      guard(() => tick(), undefined);
      loop();
    }, wait);
  })();

  let stopListen = () => {};
  stopListen = guard(
    () =>
      ctx.data.listen((e: any) => {
        const type = e?.details?.type;
        if (typeof type !== "string") return;
        if (!type.startsWith("message") && !type.startsWith("session")) return;
        scheduleRebuild();
      }),
    stopListen,
  );

  function activate(a: { kind: "up" | "down" | "tick"; turnIdx: number }) {
    const v = view();
    if (a.kind === "tick") {
      const t = v.turns[a.turnIdx];
      if (t) jumpTo(t);
      return;
    }
    if (v.tier < 3) {
      dispatch(a.kind === "up" ? "session.message.user.previous" : "session.message.user.next");
      return;
    }
    if (a.kind === "up") {
      const i = v.nav.upIndex;
      if (i !== null) {
        const t = v.turns[i];
        if (t) jumpTo(t);
      }
      return;
    }
    const i = v.nav.downIndex;
    if (i !== null) {
      const t = v.turns[i];
      if (t) jumpTo(t);
    } else {
      dispatch("session.last");
    }
  }

  function wheelBy(dir: "up" | "down", delta = 1) {
    const n = clamp(Math.round(delta * settings.wheelLines), 1, 5);
    const s = ensureSb();
    if (s) {
      try {
        (s as { stickyScroll?: boolean }).stickyScroll = false;
        const dy = dir === "up" ? -n : n;
        if (typeof s.scrollBy === "function") s.scrollBy({ x: 0, y: dy });
        else s.scrollTo(clamp(s.scrollTop + dy, 0, Math.max(0, s.scrollHeight - s.viewport.height)));
        kick();
        return;
      } catch {
        /* fall through to host commands */
      }
    }
    for (let i = 0; i < n; i++) dispatch(dir === "up" ? "session.line.up" : "session.line.down");
  }

  // Pointer path. On 2.0.19 `processSingleMouseEvent` always consumes the
  // mouse stdin event, so `prependInputHandler` never sees SGR. Listen on
  // `renderer.stdin` in parallel (do not swallow) and hit-test against view
  // geometry — the 0×0 composer.top overlay is out of Yoga flow.
  const SGR = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
  let downRow: number | null = null;
  let lastPtr = { x: -1, y: -1 };
  let stdinAcc = "";
  const handleSgr = (code: number, x: number, y: number, press: string) => {
    const isMotion = (code & 32) !== 0;
    const isWheel = (code & 64) !== 0;
    lastPtr = { x, y };

    const v = view();
    const onRail =
      v.tier >= 2 &&
      v.height > 0 &&
      x >= v.railLeft &&
      x < v.railLeft + v.gutter &&
      y >= v.railTop &&
      y < v.railTop + v.height;
    const c = v.card;
    const onCard = Boolean(
      c &&
        x >= v.railLeft - (c.w + 1) &&
        x < v.railLeft - 1 &&
        y >= v.railTop + c.top &&
        y < v.railTop + c.top + c.h,
    );

    if (onRail) {
      if (isWheel && press === "M") {
        const button = code & 3;
        const dir = button === 0 ? "up" : button === 1 ? "down" : null;
        if (dir === "up" || dir === "down") wheelBy(dir);
        dismissCard();
        return;
      }
      if (isMotion) {
        hoverRow(hitAt(y - v.railTop, v.rows));
        return;
      }
      if (press === "M") {
        dismissCard();
        downRow = hitAt(y - v.railTop, v.rows)?.row ?? null;
        return;
      }
      const r = hitAt(y - v.railTop, v.rows);
      if ((code & 3) === 0 && r && downRow === r.row && r.kind !== "blank") {
        activate({ kind: r.kind, turnIdx: r.turnIdx });
      }
      downRow = null;
      return;
    }

    if (onCard) {
      if (!isMotion) dismissCard();
      return;
    }

    if (isMotion) {
      // Leaving the rail cancels a pending dwell and an open card (§E.1
      // onMouseOut). Chevrons still keep an already-open card via hoverRow.
      dismissCard();
      return;
    }
    dismissCard();
  };
  const onStdin = (chunk: Buffer | string) => {
    try {
      stdinAcc += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      SGR.lastIndex = 0;
      let m: RegExpExecArray | null;
      let last = 0;
      while ((m = SGR.exec(stdinAcc))) {
        last = m.index + m[0].length;
        handleSgr(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, m[4]);
      }
      stdinAcc = stdinAcc.slice(last);
      if (stdinAcc.length > 128) stdinAcc = stdinAcc.slice(-128);
    } catch {
      /* ignore */
    }
  };
  const stdin = guard(() => (ctx.renderer as { stdin?: NodeJS.ReadStream }).stdin, undefined);
  guard(() => stdin?.on("data", onStdin), undefined);

  return {
    ctx,
    colors,
    view,
    tier,
    turns,
    tick,
    kick,
    hoverRow,
    dismissCard,
    jumpTo,
    activate,
    wheel(e) {
      const dir = e?.scroll?.direction;
      if (dir !== "up" && dir !== "down") return;
      wheelBy(dir, Number(e?.scroll?.delta) || 1);
    },

    debug() {
      const v = view();
      const m = sample();
      return {
        tier: v.tier,
        railLeft: v.railLeft,
        railTop: v.railTop,
        gutter: v.gutter,
        height: v.height,
        chev: v.chev,
        windowed: v.windowed,
        i0: v.i0,
        i1: v.i1,
        turnCount: v.turns.length,
        turnIDs: v.turns.map((t) => t.id),
        rows: v.rows.map((r) => ({ row: r.row, kind: r.kind, turnIdx: r.turnIdx })),
        activeIdx: v.nav.activeIdx,
        upIndex: v.nav.upIndex,
        downIndex: v.nav.downIndex,
        atBottom: m?.atBottom ?? null,
        scrollTop: m?.scrollTop ?? null,
        maxScroll: m?.maxScroll ?? null,
        // Raw measure items: `top` is the row's CONTENT offset (the host's own
        // `scrollTop + node.y − viewport.y`, scroll-invariant — see measure()).
        items: m?.items ?? [],
        // The same rows relative to the viewport top (`top − scrollTop`): the
        // "jumped turn sits at the viewport top" check reads this.
        viewItems: m ? m.items.map((i) => ({ id: i.id, top: i.top - m.scrollTop })) : [],
        hoverIdx: hover(),
        card: v.card ? { top: v.card.top, h: v.card.h, w: v.card.w, header: v.card.header } : null,
        pointer: lastPtr,
        downRow,
        jumping: active?.token ?? 0,
        jumpRung: lastJumpRung,
        viewportY: sb ? numOrNull((sb as any).viewport?.y) : null,
      };
    },

    dispose() {
      disposed = true;
      active?.ac.abort();
      clearTimeout(timer);
      clearTimeout(rebuildTimer);
      clearTimeout(dwellTimer);
      detachBar();
      guard(() => stopListen(), undefined);
      guard(() => ctx.renderer.off("resize", onResize), undefined);
      guard(() => stdin?.off?.("data", onStdin), undefined);
    },
  };
}

// ---- helpers --------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** `n` frames via rAF, falling back to timers where rAF is absent. */
export function frames(n: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const raf = (globalThis as any).requestAnimationFrame as undefined | ((cb: () => void) => void);
    let i = 0;
    const step = () => {
      if (++i >= n) {
        resolve();
        return;
      }
      if (raf) raf(step);
      else setTimeout(step, 16);
    };
    if (raf) raf(step);
    else setTimeout(step, 16);
  });
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function turnsEq(a: Turn[], b: Turn[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].created !== b[i].created) return false;
  }
  return true;
}

function measureEq(a: Measure | null, b: Measure | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.scrollTop !== b.scrollTop || a.maxScroll !== b.maxScroll || a.atBottom !== b.atBottom) return false;
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i++) {
    if (a.items[i].id !== b.items[i].id || a.items[i].top !== b.items[i].top) return false;
  }
  return true;
}

function geomEq(a: Geom, b: Geom): boolean {
  return (
    a.railTop === b.railTop &&
    a.railLeft === b.railLeft &&
    a.gutter === b.gutter &&
    a.height === b.height &&
    a.sbScreenX === b.sbScreenX &&
    a.sbScreenY === b.sbScreenY
  );
}
