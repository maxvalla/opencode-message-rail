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
  // TODO(theme): defensively pick colors from ctx.theme along known key paths with everforest fallbacks.
  throw new Error("TODO: railColors");
}

export function toneColor(tone: "muted" | "rail" | "fg" | "accent", c: RailColors): string {
  // TODO(theme): map tone -> RailColors field.
  throw new Error("TODO: toneColor");
}
