import type { Context } from "@opencode-ai/plugin/tui/context";
import type { MouseEvent } from "@opentui/core";
import type { Nav, RailRow, Turn } from "./geom";
import type { RailColors } from "./theme";

export type Tier = 0 | 1 | 2 | 3;

export interface Card {
  w: number;
  h: number;
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

export function createRail(
  ctx: Context,
  settings: Settings,
  toastOnce: (message: string, variant?: "warning" | "error") => void,
): RailController {
  // TODO(controller): own the signals (tier/turns/sample/geom/hover/card/jumped), the probe cache,
  // dwell timer, jump strategies and lifecycle; must dispose with the plugin's reactive owner.
  throw new Error("TODO: createRail");
}

export function sleep(ms: number): Promise<void> {
  // TODO(controller): resolve after ms.
  throw new Error("TODO: sleep");
}

/** `n` frames via rAF, falling back to timers where rAF is absent. */
export function frames(n: number): Promise<void> {
  // TODO(controller): wait n animation frames (rAF, else ~16 ms timer).
  throw new Error("TODO: frames");
}
