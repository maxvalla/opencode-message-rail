/** @jsxImportSource @opentui/solid */
import type { MouseEvent } from "@opentui/core";
import type { RailRow } from "./geom";
import type { RailColors } from "./theme";
import type { View } from "./controller";

export interface Activation {
  kind: "up" | "down" | "tick";
  turnIdx: number;
}

export function RailOverlay(props: {
  view: View;
  colors: RailColors;
  onHoverRow: (row: RailRow | null) => void;
  onDismissCard: () => void;
  onActivate: (a: Activation) => void;
  onWheel: (e: MouseEvent) => void;
}) {
  // TODO(rail): render the absolute-positioned overlay (ticks + chevrons) and the hover preview card,
  // hit-testing rows via hitAt against view.rows so render and hit-test share one geometry source.
  throw new Error("TODO: RailOverlay");
}
