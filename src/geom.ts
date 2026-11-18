/**
 * Pure geometry for the message rail — docs/design.md §A.5 (model), §E.3 (CJK
 * width), §G.4 (declared signatures).
 *
 * No host access: no @opentui/*, no solid-js, no DOM, no timers, no I/O. Every
 * export is deterministic and unit-tested in src/geom.test.ts.
 *
 * The one structural rule: `buildRailRows` turns a `RowLayout` into a flat
 * `RailRow[]` indexed by ABSOLUTE rail row, and `hitAt` indexes that same
 * array — render and hit-test consume one geometry, they cannot diverge.
 */

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
  return v < lo ? lo : v > hi ? hi : v;
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
  const n = turns.length;
  if (n === 0) {
    return { activeIdx: -1, upIndex: null, upInferred: false, downIndex: null, downInferred: false, atBottom };
  }

  // Mounted = measured items whose id is a known turn; top-sorted.
  const ord = new Map<string, number>();
  for (let i = 0; i < n; i++) ord.set(turns[i].id, i);
  const mounted: Array<{ i: number; top: number }> = [];
  for (const it of items) {
    const i = ord.get(it.id);
    if (i !== undefined) mounted.push({ i, top: it.top });
  }
  mounted.sort((a, b) => a.top - b.top);

  // Active: last measured turn at or above the viewport's top edge.
  // Sticky bottom is special: the last ~100 mounted rows are often the
  // assistant's parts, so the last *user* turn is culled and the scan would
  // light an earlier still-mounted user tick. Pin to the last turn so the
  // rail shows "you are in the latest conversation".
  let activeIdx = -1;
  if (atBottom) {
    activeIdx = n - 1;
  } else {
    for (const m of mounted) if (m.top <= viewTop) activeIdx = m.i;
    if (activeIdx < 0) activeIdx = mounted.length ? Math.max(0, mounted[0].i - 1) : 0;
  }

  // Up: last turn strictly above viewTop; else infer the turn just above the
  // first mounted one (flagged — it is not measured, only ordinal).
  let upIndex: number | null = null;
  let upInferred = false;
  for (const m of mounted) if (m.top < viewTop) upIndex = m.i;
  if (upIndex === null && mounted.length && mounted[0].i > 0) {
    upIndex = mounted[0].i - 1;
    upInferred = true;
  }

  // Down: first turn below viewTop. The `maxScroll + 1` bound is load-bearing:
  // the last turn's measured top is usually the clamped maxScroll, not its
  // natural content offset. When nothing measured qualifies and we are not at
  // the bottom, fall back to the last turn (flagged).
  let downIndex: number | null = null;
  let downInferred = false;
  for (const m of mounted) {
    if (m.top > viewTop && m.top <= maxScroll + 1) {
      downIndex = m.i;
      break;
    }
  }
  if (downIndex === null && !atBottom) {
    downIndex = n - 1;
    downInferred = true;
  }

  return { activeIdx, upIndex, upInferred, downIndex, downInferred, atBottom };
}

export interface RowLayout {
  /**
   * `slots[k]` is the BODY-relative rail row of the k-th rendered turn (body =
   * the rows left after the chevrons). The turn's index is `i0 + k`. Fit case:
   * sparse rows (`off + step * k`); windowed case: contiguous rows `k`.
   */
  slots: number[];
  i0: number;
  i1: number;
  step: number;
  windowed: boolean;
}

/**
 * T2 unanchored layout (§C.1): we know turn order but not positions.
 * `slot[i] = round(i * (A - 1) / (n - 1))`; collisions overwrite, last turn wins.
 */
export function layoutEven(n: number, H: number, chev: number): RowLayout {
  const A = Math.max(1, H - chev);
  if (n === 0) return { slots: [], i0: 0, i1: 0, step: 1, windowed: false };
  const slots: number[] = [];
  if (n === 1 || A === 1) {
    for (let i = 0; i < n; i++) slots.push(0);
    return { slots, i0: 0, i1: n, step: 1, windowed: false };
  }
  for (let i = 0; i < n; i++) slots.push(Math.round((i * (A - 1)) / (n - 1)));
  return { slots, i0: 0, i1: n, step: 1, windowed: false };
}

/** dsh sliding-window + fit layout. A = rows available (H - chevrons). */
export function layoutRows(n: number, H: number, chev: number, activeIdx: number, atBottom: boolean): RowLayout {
  const A = Math.max(1, H - chev);
  if (n === 0) return { slots: [], i0: 0, i1: 0, step: 1, windowed: false };

  if (n <= A) {
    // Fit case (§A.5): evenly spaced ticks, centred in the available rows.
    const step = Math.min(2, Math.max(1, Math.floor(A / n)));
    const span = step * (n - 1) + 1;
    const off = Math.floor((A - span) / 2);
    const slots: number[] = [];
    for (let i = 0; i < n; i++) slots.push(off + step * i);
    return { slots, i0: 0, i1: n, step, windowed: false };
  }

  // Sliding window (§A.5): a conversation-order slice around the active turn.
  const cap = A;
  const anchor = activeIdx >= 0 ? activeIdx : n - 1;
  const tail = Math.max(0, n - cap);
  let i0: number;
  if (atBottom && anchor >= tail) {
    i0 = tail; // sticky tail: the last `cap` turns
  } else if (atBottom) {
    // The measured active turn sits above the sticky tail. §A.5 promises the
    // active turn is never excluded from the window, so slide the window to
    // [anchor, anchor + cap) instead of dropping it.
    i0 = clamp(anchor, 0, tail);
  } else {
    i0 = clamp(anchor - Math.floor(cap / 2), 0, tail);
  }
  const i1 = Math.min(n, i0 + cap);
  const slots: number[] = [];
  for (let k = 0; k < i1 - i0; k++) slots.push(k);
  return { slots, i0, i1, step: 1, windowed: true };
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
  const rows: RailRow[] = new Array(o.height);
  for (let r = 0; r < o.height; r++) {
    rows[r] = { row: r, kind: "blank", turnIdx: -1, glyph: " ", tone: "muted" };
  }
  if (o.height <= 0) return rows;

  const hasTop = o.chev > 0;
  const hasBottom = o.chev > 1 && o.height > 1;
  if (hasTop) {
    rows[0] = { row: 0, kind: "up", turnIdx: -1, glyph: "↑", tone: o.hasUp ? "fg" : "muted" };
  }
  if (hasBottom) {
    const r = o.height - 1;
    rows[r] = { row: r, kind: "down", turnIdx: -1, glyph: "↓", tone: o.hasDown ? "fg" : "muted" };
  }

  // Body rows = between the chevrons; layout.slots values are body-relative,
  // and the k-th rendered turn is `layout.i0 + k`.
  const bodyStart = hasTop ? 1 : 0;
  const bodyEnd = o.height - (hasBottom ? 1 : 0);
  const bodyRows = Math.max(0, bodyEnd - bodyStart);
  const count = Math.min(o.layout.slots.length, bodyRows);
  for (let k = 0; k < count; k++) {
    const rel = o.layout.slots[k];
    if (!Number.isInteger(rel) || rel < 0 || rel >= bodyRows) continue;
    const turnIdx = o.layout.i0 + k;
    const active = turnIdx === o.activeIdx;
    const jumped = turnIdx === o.jumpedIdx;
    const hovered = turnIdx === o.hoverIdx;
    rows[bodyStart + rel] = {
      row: bodyStart + rel,
      kind: "tick",
      turnIdx,
      glyph: active ? "▌" : jumped ? "┃" : hovered ? "│" : "·",
      tone: active || jumped ? "accent" : hovered ? "fg" : "rail",
    };
  }
  return rows;
}

/** Index into the exact array the renderer drew from. */
export function hitAt(dy: number, rows: RailRow[]): RailRow | null {
  if (dy < 0 || dy >= rows.length) return null;
  const r = rows[dy];
  return !r || r.kind === "blank" ? null : r;
}

/**
 * Rail row of the rendered tick for `turnIdx`, or null when that turn is not in
 * the current window. Render, hit-test and the hover card all read the same
 * `RailRow[]`, so the card can anchor only to a row the rail actually painted —
 * the fit/T2 layouts are sparse, and `i0 + k` is NOT a row.
 */
export function tickRow(rows: RailRow[], turnIdx: number): number | null {
  for (const r of rows) if (r.kind === "tick" && r.turnIdx === turnIdx) return r.row;
  return null;
}

/** Vertically centre a card of height `h` on `row`, clamped inside the rail. */
export function anchorTop(row: number, h: number, height: number): number {
  return clamp(row - Math.floor(h / 2), 0, Math.max(0, height - h));
}

export function charW(c: string): number {
  return (c.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
}

export function strW(s: string): number {
  let w = 0;
  for (const c of s) w += charW(c);
  return w;
}

export function takeW(s: string, max: number): string {
  let out = "",
    w = 0;
  for (const c of s) {
    const cw = charW(c);
    if (w + cw > max) break;
    out += c;
    w += cw;
  }
  return out;
}

/** CJK-width-aware wrap + truncate. No emitted line ever exceeds `width` columns. */
export function truncateWrapped(s: string, width: number, maxLines: number): string[] {
  if (maxLines <= 0) return [];
  const out: string[] = [];
  const push = (line: string) => {
    if (out.length < maxLines) out.push(line);
  };
  for (const raw of s.split("\n")) {
    let line = "",
      w = 0;
    for (const c of raw) {
      const cw = charW(c);
      if (w + cw > width) {
        push(line);
        line = "";
        w = 0;
        if (out.length >= maxLines) break;
      }
      line += c;
      w += cw;
    }
    if (out.length >= maxLines) break;
    push(line);
    if (out.length >= maxLines) break;
  }
  if (!out.length) out.push("");
  const last = out[out.length - 1];
  // The ellipsis is U+2026, which charW measures as 2 columns, so the content
  // budget is `width - charW("…")`. (The design's `width - 1` overflows the
  // stated invariant "no emitted line ever exceeds width columns".)
  const ellipsisW = charW("…");
  if (width >= ellipsisW && strW(last) >= width - 1) {
    out[out.length - 1] = takeW(last, width - ellipsisW) + "…";
  }
  return out;
}
