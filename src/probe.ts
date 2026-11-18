import type { Renderable } from "@opentui/core";

/**
 * Structural probe: `instanceof` must not appear here (the plugin resolves its
 * own @opentui/core copy while the host bundles another). A malformed tree
 * yields null/empty, never a throw into the reactive tree.
 */

export interface TextScroller {
  readonly children?: Renderable[];
  getChildren?(): Renderable[];
  scrollTop: number;
  scrollHeight: number;
  readonly viewport: { x: number; y: number; width: number; height: number };
  readonly verticalScrollBar: unknown;
  scrollTo(position: number | { x: number; y: number }): void;
  scrollBy?(delta: number | { x: number; y: number }): void;
  /** 0.8.4+: scrolls a descendant into view with an alignment, then re-applies after layout. */
  scrollChildIntoView?(
    child: string,
    options?: { align?: "nearest" | "start" | "end"; inset?: number },
  ): void;
  /** 0.8.4+: runs once in the next frame, after layout and before paint. */
  afterLayout?(callback: () => void): void;
  readonly height: number;
  readonly width: number;
  readonly parent: Renderable | null;
  stickyScroll?: boolean;
  stickyStart?: string;
  readonly isDestroyed?: boolean;
}

export interface Measure {
  scrollTop: number;
  maxScroll: number;
  viewH: number;
  height: number;
  atBottom: boolean;
  stale: boolean;
  items: Array<{ id: string; top: number }>;
}

export const PROBE_MAX_NODES = 5_000;
export const PROBE_MAX_DEPTH = 40;
export const PROBE_BUDGET_MS = 8;

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null;

/**
 * Direct children, tolerating both shapes the host has shipped. On 2.0.19 the session scrollbox
 * exposes `getChildren()` and has **no** `children` array, so an `Array.isArray(v.children)` gate
 * rejected every real scrollbox (live gate run, 2026-09-29). Prefer an array field when present
 * (that is what the host's own `messagePositions()` iterates), fall back to the getter.
 */
function childrenOf(node: any): any[] {
  try {
    if (Array.isArray(node?.children)) return node.children;
  } catch {
    /* fall through */
  }
  try {
    if (typeof node?.getChildren === "function") {
      const kids = node.getChildren();
      if (Array.isArray(kids)) return kids;
    }
  } catch {
    /* fall through */
  }
  return [];
}

/**
 * Canonical turn id from a scrollbox child. Top-level children mix bare `msg_…`
 * ids with `session-part:<msgID>:<partID>` rows. At the bottom of a live turn
 * the viewport is often *only* part rows, so matching bare ids alone drops the
 * rail to T2.
 */
export function turnIdOf(raw: unknown, ids: Set<string>): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (ids.has(raw)) return raw;
  if (raw.startsWith("session-part:")) {
    const msg = raw.slice("session-part:".length).split(":")[0] ?? "";
    if (msg && ids.has(msg)) return msg;
  }
  return null;
}

/** `performance.now()` with a `Date.now()` fallback — this module is contract-bound to never throw. */
const nowMs = (): number => {
  const perf = (globalThis as any).performance;
  if (perf && typeof perf.now === "function") {
    const t = perf.now();
    if (num(t)) return t;
  }
  return Date.now();
};

/** The honest degradation for a failed read: the controller maps `stale` to tier ≤ 1. */
function emptyMeasure(): Measure {
  return { scrollTop: 0, maxScroll: 0, viewH: 0, height: 0, atBottom: false, stale: true, items: [] };
}

/** Structural check, NOT instanceof: the plugin resolves its own @opentui/core copy,
 *  the host bundles another, so instanceof silently fails across copies. */
export function asTextScroller(v: unknown): TextScroller | null {
  try {
    if (!obj(v)) return null;
    // Either shape counts as "has children" — see `childrenOf`. Requiring the array field rejected
    // every real scrollbox on 2.0.19.
    if (!Array.isArray((v as any).children) && typeof (v as any).getChildren !== "function") return null;
    if (!num(v.scrollTop) || !num(v.scrollHeight)) return null;
    if (!obj(v.viewport) || !num(v.viewport.y) || !num(v.viewport.height)) return null;
    if (typeof v.scrollTo !== "function") return null;
    if (!obj(v.verticalScrollBar)) return null;
    return v as unknown as TextScroller;
  } catch {
    return null; // a getter threw on the way in — not a scrollbox we can trust
  }
}

/** True while `node` is still reachable from `root` through parent links (bounded at 64 hops). */
export function attached(root: Renderable, node: Renderable): boolean {
  try {
    let cur: any = node;
    for (let hops = 0; hops < 64 && cur; hops++) {
      if (cur === root) return true;
      cur = cur.parent;
    }
    return false;
  } catch {
    return false;
  }
}

/** `attached` plus the destroyed check — run before every cached read (§B.5). */
export function attachedCheck(root: Renderable, sb: TextScroller | null): boolean {
  try {
    if (!sb) return false;
    if ((sb as any).isDestroyed) return false;
    return attached(root, sb as unknown as Renderable);
  } catch {
    return false;
  }
}

interface ScoredCandidate {
  sb: TextScroller;
  host: Renderable;
  score: number;
  hits: number;
  stickyStart: string | undefined;
}

/**
 * Bounded non-recursive BFS. Guards: monotone index cursor (no `shift()`),
 * visited set, node/depth/time caps, and no descent into a matched scrollbox.
 */
function scanTranscripts(root: Renderable, knownIds: Set<string>): ScoredCandidate[] {
  const t0 = nowMs();
  const seen = new Set<any>();
  const q: Array<{ node: any; depth: number }> = [{ node: root, depth: 0 }];
  const cands: ScoredCandidate[] = [];
  let visited = 0;
  let head = 0;

  while (head < q.length) {
    if (visited > PROBE_MAX_NODES) break;
    if (nowMs() - t0 > PROBE_BUDGET_MS) break;
    const { node, depth } = q[head++];
    visited++;
    if (!node || seen.has(node)) continue;
    if (depth > PROBE_MAX_DEPTH) continue;
    seen.add(node);

    if (node !== root) {
      const sb = asTextScroller(node);
      if (sb) {
        const own: string[] = [];
        for (const ch of childrenOf(sb)) if (ch?.id) own.push(String(ch.id)); // own children only
        let hits = 0;
        const hitIds = new Set<string>();
        for (const id of own) {
          const turn = turnIdOf(id, knownIds);
          if (turn && !hitIds.has(turn)) {
            hitIds.add(turn);
            hits++;
          }
        }
        const stickyStart: string | undefined = (sb as any).stickyStart;
        const sticky = stickyStart === "bottom";
        const height = num(sb.height) ? sb.height : 0;
        const width = num(sb.width) ? sb.width : 0;
        if (hits > 0 || (sticky && num(sb.height) && sb.height >= 6)) {
          cands.push({
            sb,
            // Keep the PARENT as host: the scrollbox may be width-constrained, and the parent
            // column box is the one whose right edge carries the 2-column gutter (§B.2).
            host: ((sb as any).parent as Renderable) ?? root,
            // Width is a real discriminator on an empty session: the sidebar's own bottom-sticky
            // scrollbox is TALLER than the transcript (43 vs 41 rows on 2.0.19), so height alone
            // would pick the sidebar. The transcript is the wide one.
            score: hits * 100 + (sticky ? 20 : 0) + Math.min(height, 60) + Math.min(width, 60),
            hits,
            stickyStart,
          });
          continue; // never descend into a matched scrollbox
        }
      }
    }

    for (const ch of childrenOf(node)) if (ch && !seen.has(ch)) q.push({ node: ch, depth: depth + 1 });
  }

  cands.sort((a, b) => b.score - a.score);
  return cands;
}

/**
 * Find the transcript scrollbox. Ties break on `height` + `width` (both folded into the score),
 * so on a fresh empty session (no `knownIds`) the widest bottom-sticky scrollbox wins — the
 * sidebar's own bottom-sticky list is taller but far narrower.
 */
export function findTranscript(
  root: Renderable,
  knownIds: Set<string>,
): { sb: TextScroller; host: Renderable } | null {
  try {
    const cands = scanTranscripts(root, knownIds);
    if (!cands.length) return null;
    return { sb: cands[0].sb, host: cands[0].host };
  } catch {
    return null;
  }
}

/** Top-level children only — mirrors the host's own messagePositions(), and is O(viewport rows). */
export function measure(sb: TextScroller, ids: Set<string>, cap = 200): Measure {
  try {
    const maxScroll = Math.max(0, sb.scrollHeight - sb.viewport.height);
    const items: Array<{ id: string; top: number }> = [];
    const seen = new Set<string>();
    let scanned = 0;
    for (const ch of childrenOf(sb)) {
      if (++scanned > cap) break;
      const id = turnIdOf(ch?.id, ids);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, top: sb.scrollTop + ch.y - sb.viewport.y });
    }
    items.sort((a, b) => a.top - b.top);
    const stale =
      sb.scrollTop < 0 ||
      sb.scrollTop > maxScroll + 1 ||
      sb.scrollHeight <= 0 ||
      sb.viewport.height <= 0;
    return {
      scrollTop: sb.scrollTop,
      maxScroll,
      viewH: sb.viewport.height,
      height: sb.height,
      atBottom: maxScroll - sb.scrollTop <= 1,
      items,
      stale,
    };
  } catch {
    return emptyMeasure();
  }
}
