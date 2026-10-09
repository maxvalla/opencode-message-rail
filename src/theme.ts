/**
 * Defensive theme reader — docs/design.md §G.6 (declared signatures), §E.2 (fixed fallbacks).
 *
 * Every read is guarded with fixed everforest fallbacks (the same values the
 * reference plugin hard-codes for the same reason): a host theme shape change
 * degrades to a readable rail, never to a throw and never to `undefined` in a
 * render prop.
 */

import type { Context } from "@opencode-ai/plugin/tui/context";

export interface RailColors {
  rail: string;
  muted: string;
  foreground: string;
  accent: string;
  background: string;
}

/**
 * `ResolvedTheme` is imported by context.d.ts from "@opencode-ai/theme/tui", which is not
 * installed in the reference plugin's tree, so the leaf shape is not readable as a type here.
 * Read defensively down the known key paths with fixed fallbacks (everforest darkStep family,
 * the same values the reference plugin hard-codes for the same reason).
 */
export function railColors(ctx: Context): RailColors {
  const t = ctx.theme as any;
  const pick = (path: string[], fallback: string): string => {
    let cur: any = t;
    for (const k of path) {
      if (!cur || typeof cur !== "object") return fallback;
      cur = cur[k];
    }
    return typeof cur === "string" ? cur : fallback;
  };
  const dark = ctx.themeMode !== "light";
  return {
    rail: pick(["text", "muted"], dark ? "#7a8478" : "#8a8a8a"),
    muted: pick(["border", "base"], dark ? "#475258" : "#c0c0c0"),
    foreground: pick(["text", "base"], dark ? "#d3c6aa" : "#2b2b2b"),
    accent: pick(["text", "action", "primary", "base"], dark ? "#a7c080" : "#3f7f3f"),
    background: pick(
      ["background", "panel", "base"],
      pick(["background", "raised", "base"], dark ? "#2d353b" : "#f4f4f4"),
    ),
  };
}

export function toneColor(tone: "muted" | "rail" | "fg" | "accent", c: RailColors): string {
  switch (tone) {
    case "accent":
      return c.accent;
    case "fg":
      return c.foreground;
    case "rail":
      return c.rail;
    default:
      return c.muted;
  }
}
