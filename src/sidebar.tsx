/** @jsxImportSource @opentui/solid */
import type { Turn } from "./geom";
import type { RailColors } from "./theme";

export function RailSidebar(props: {
  active: boolean;
  turns: Turn[];
  limit: number;
  colors: RailColors;
  onJump: (t: Turn) => void;
}) {
  // TODO(sidebar): render the T1 fallback list — the last `limit` turns, clickable to jump.
  throw new Error("TODO: RailSidebar");
}
