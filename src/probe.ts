import type { Renderable } from "@opentui/core";

// TODO(probe): none outstanding. `stale` reads only negative/oversized scrollTop and empty
//   geometry; it deliberately does not age-gate on scrollHeight (constant on a static session).

export interface TextScroller {
  readonly children: Renderable[];
  scrollTop: number;
  scrollHeight: number;
  readonly viewport: { x: number; y: number; width: number; height: number };
  readonly verticalScrollBar: unknown;
  scrollTo(position: number | { x: number; y: number }): void;
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

/** Structural check, NOT instanceof: the plugin resolves its own @opentui/core copy,
 *  the host bundles another, so instanceof silently fails across copies. */
export function asTextScroller(v: unknown): TextScroller | null {
  // TODO(probe): duck-type a scrollbox — children[] + scrollTop/scrollHeight + viewport + scrollTo + scroll bar.
  throw new Error("TODO: asTextScroller");
}

export function attached(root: Renderable, node: Renderable): boolean {
  // TODO(probe): walk node.parent up to `root` (max 64 hops) to prove attachment.
  throw new Error("TODO: attached");
}

export function attachedCheck(root: Renderable, sb: TextScroller | null): boolean {
  // TODO(probe): null/destroyed guard, then attached().
  throw new Error("TODO: attachedCheck");
}

export function findTranscript(
  root: Renderable,
  knownIds: Set<string>,
): { sb: TextScroller; host: Renderable } | null {
  // TODO(probe): bounded BFS that scores scrollbox candidates by known-id hits + sticky-bottom + height.
  throw new Error("TODO: findTranscript");
}

/** Top-level children only — mirrors the host's own messagePositions(), and is O(viewport rows). */
export function measure(sb: TextScroller, ids: Set<string>, cap = 200): Measure {
  // TODO(probe): map known message ids to viewport-relative Y and compute stale/atBottom.
  throw new Error("TODO: measure");
}
