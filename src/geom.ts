export interface Turn {
  id: string;
  created: number;
  text: string;
}

export interface Nav {
  activeIdx: number;
  upIndex: number | null;
  upInferred: boolean;
  downIndex: number | null;
  downInferred: boolean;
  atBottom: boolean;
}

export type Tone = "muted" | "rail" | "fg" | "accent";

export interface RailRow {
  row: number;
  kind: "up" | "down" | "tick" | "blank";
  turnIdx: number; // -1 when not a tick
  glyph: string;
  tone: Tone;
}

export function clamp(v: number, lo: number, hi: number): number {
  // TODO(geom): clamp v into [lo, hi].
  throw new Error("TODO: clamp");
}

/**
 * Port of the host's active-anchor scan plus the dsh up/down rules.
 * active = the largest measured top that is <= viewTop  (i.e. the top-most visible turn).
 */
export function computeNav(
  turns: Turn[],
  items: Array<{ id: string; top: number }>,
  viewTop: number,
  maxScroll: number,
  atBottom: boolean,
): Nav {
  // TODO(geom): derive active/up/down anchors from mounted message positions and viewTop.
  throw new Error("TODO: computeNav");
}

export interface RowLayout {
  slots: number[];
  i0: number;
  i1: number;
  step: number;
  windowed: boolean;
}

/** dsh sliding-window + fit layout. A = rows available (H - chevrons). */
export function layoutRows(n: number, H: number, chev: number, activeIdx: number, atBottom: boolean): RowLayout {
  // TODO(geom): fit (n <= A) centres ticks; overflow windows the visible slice around the active turn.
  throw new Error("TODO: layoutRows");
}

/**
 * One descriptor per ABSOLUTE rail row. Render iterates this array; hitAt indexes this array.
 * That is the structural enforcement of "hit-test shares geometry" — there is no second derivation.
 */
export function buildRailRows(o: {
  height: number;
  chev: number;
  layout: RowLayout;
  activeIdx: number;
  hoverIdx: number | null;
  jumpedIdx: number | null;
  hasUp: boolean;
  hasDown: boolean;
}): RailRow[] {
  // TODO(geom): emit one RailRow per absolute row (chevrons, ticks with glyph/tone, blanks).
  throw new Error("TODO: buildRailRows");
}

/** Index into the exact array the renderer drew from. */
export function hitAt(dy: number, rows: RailRow[]): RailRow | null {
  // TODO(geom): bounds-check dy, return the row, or null for out-of-range/blank.
  throw new Error("TODO: hitAt");
}

export function charW(c: string): number {
  // TODO(geom): CJK-width helper — 2 columns above U+00FF, else 1.
  throw new Error("TODO: charW");
}

export function strW(s: string): number {
  // TODO(geom): sum charW over the string's code points.
  throw new Error("TODO: strW");
}

export function takeW(s: string, max: number): string {
  // TODO(geom): longest prefix whose display width fits in `max` columns.
  throw new Error("TODO: takeW");
}

/** CJK-width-aware wrap + truncate. No emitted line ever exceeds `width` columns. */
export function truncateWrapped(s: string, width: number, maxLines: number): string[] {
  // TODO(geom): wrap on width, cap at maxLines, ellipsize the last line when truncated.
  throw new Error("TODO: truncateWrapped");
}
