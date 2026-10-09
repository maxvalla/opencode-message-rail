/**
 * Unit tests for the pure geometry module (docs/design.md §A.5 model,
 * §E.3 CJK width, §I.4 build-order invariants).
 *
 * Runner: bun's built-in test runner — no test-runner dependency.
 *
 * Type note: this package does not depend on @types/bun, so the `bun:test`
 * module is declared locally in src/bun-test.d.ts (see the note there).
 */
import { expect, test } from "bun:test";
import {
  buildRailRows,
  charW,
  clamp,
  computeNav,
  hitAt,
  layoutEven,
  layoutRows,
  strW,
  takeW,
  truncateWrapped,
  type Turn,
} from "./geom";

const makeTurns = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, created: i, text: `turn ${i}` }));

const makeItems = (pairs: Array<[number, number]>): Array<{ id: string; top: number }> =>
  pairs.map(([i, top]) => ({ id: `t${i}`, top }));

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

test("clamp: pins v into [lo, hi]", () => {
  expect(clamp(5, 0, 3)).toBe(3);
  expect(clamp(-1, 0, 3)).toBe(0);
  expect(clamp(2, 0, 3)).toBe(2);
  expect(clamp(0, 0, 0)).toBe(0);
  expect(clamp(-7, -3, 3)).toBe(-3);
  expect(clamp(7, -3, 3)).toBe(3);
  for (let v = -8; v <= 8; v++) {
    for (let lo = -4; lo <= 0; lo++) {
      for (let hi = 0; hi <= 4; hi++) {
        expect(clamp(v, lo, hi)).toBe(Math.min(hi, Math.max(lo, v)));
      }
    }
  }
});

// ---------------------------------------------------------------------------
// layoutRows — fit case, sliding window, sticky tail, edges
// ---------------------------------------------------------------------------

test("layoutEven: T2 unanchored spacing is round(i*(A-1)/(n-1)), last occupant wins collisions", () => {
  expect(layoutEven(0, 10, 2)).toEqual({ slots: [], i0: 0, i1: 0, step: 1, windowed: false });
  expect(layoutEven(1, 10, 2)).toEqual({ slots: [0], i0: 0, i1: 1, step: 1, windowed: false });
  expect(layoutEven(5, 10, 0).slots).toEqual([0, 2, 5, 7, 9]);
  expect(layoutEven(5, 12, 2).slots).toEqual([0, 2, 5, 7, 9]);
  const crowded = layoutEven(12, 6, 2);
  expect(crowded.i0).toBe(0);
  expect(crowded.i1).toBe(12);
  expect(crowded.windowed).toBe(false);
  expect(crowded.slots).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
});

test("layoutRows: n = 0 yields an empty, non-windowed layout for any H / chev / atBottom", () => {
  for (let H = 0; H <= 8; H++) {
    for (const chev of [0, 1, 2]) {
      for (const atBottom of [false, true]) {
        expect(layoutRows(0, H, chev, -1, atBottom)).toEqual({ slots: [], i0: 0, i1: 0, step: 1, windowed: false });
        expect(layoutRows(0, H, chev, 0, atBottom)).toEqual({ slots: [], i0: 0, i1: 0, step: 1, windowed: false });
      }
    }
  }
});

test("layoutRows fit case (n <= A): step 1|2, even distribution, centred within ±1, all slots in [0, A)", () => {
  for (const chev of [0, 2]) {
    for (let A = 1; A <= 12; A++) {
      const H = A + chev;
      for (let n = 1; n <= A; n++) {
        for (const atBottom of [false, true]) {
          // Fit case must not depend on atBottom (or on the active turn).
          const lay = layoutRows(n, H, chev, Math.max(0, n - 1), atBottom);
          const expectedStep = Math.min(2, Math.max(1, Math.floor(A / n)));

          expect(lay.windowed).toBe(false);
          expect(lay.i0).toBe(0);
          expect(lay.i1).toBe(n);
          expect(lay.step).toBe(expectedStep);
          expect(lay.step === 1 || lay.step === 2).toBe(true);
          expect(lay.slots.length).toBe(n);

          for (const s of lay.slots) {
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThan(A);
          }
          for (let i = 1; i < n; i++) expect(lay.slots[i] - lay.slots[i - 1]).toBe(expectedStep);

          const span = expectedStep * (n - 1) + 1;
          const off = Math.floor((A - span) / 2);
          expect(lay.slots[0]).toBe(off);
          const left = off;
          const right = A - 1 - lay.slots[n - 1];
          expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
        }
      }
    }
  }
});

test("layoutRows windowed (n > A): contiguous rows, length <= A, i0..i1 bounds, active never excluded", () => {
  for (const chev of [0, 2]) {
    for (let A = 1; A <= 10; A++) {
      const H = A + chev;
      for (let n = A + 1; n <= A + 10; n++) {
        for (const atBottom of [false, true]) {
          for (let activeIdx = -1; activeIdx < n; activeIdx++) {
            const lay = layoutRows(n, H, chev, activeIdx, atBottom);

            expect(lay.windowed).toBe(true);
            expect(lay.step).toBe(1);
            expect(lay.i0).toBeGreaterThanOrEqual(0);
            expect(lay.i1).toBeLessThanOrEqual(n);
            expect(lay.i0).toBeLessThan(lay.i1);
            expect(lay.i1 - lay.i0).toBeLessThanOrEqual(A); // window length <= A

            // Window contiguity: slots are consecutive rows starting at 0.
            expect(lay.slots.length).toBe(lay.i1 - lay.i0);
            for (let k = 0; k < lay.slots.length; k++) expect(lay.slots[k]).toBe(k);

            // The active turn is never excluded (anchor = n - 1 when unmeasured).
            const anchor = activeIdx >= 0 ? activeIdx : n - 1;
            expect(lay.i0).toBeLessThanOrEqual(anchor);
            expect(lay.i1).toBeGreaterThan(anchor);

            // Non-sticky branch is exactly centred on the anchor.
            if (!atBottom) {
              const i0 = Math.min(Math.max(anchor - Math.floor(A / 2), 0), Math.max(0, n - A));
              expect(lay.i0).toBe(i0);
              expect(lay.i1).toBe(Math.min(n, i0 + A));
            }
          }
        }
      }
    }
  }
});

test("layoutRows sticky tail: atBottom with an in-tail anchor shows the last cap turns", () => {
  for (const chev of [0, 2]) {
    for (let A = 1; A <= 8; A++) {
      const H = A + chev;
      for (let n = A + 1; n <= A + 8; n++) {
        const tail = n - A;
        for (const activeIdx of [-1, n - 1, tail, Math.min(n - 1, tail + 2)]) {
          const lay = layoutRows(n, H, chev, activeIdx, true);
          expect(lay.windowed).toBe(true);
          expect(lay.i0).toBe(tail);
          expect(lay.i1).toBe(n);
          expect(lay.slots).toEqual(Array.from({ length: A }, (_, k) => k));
        }
      }
    }
  }
});

test("layoutRows: atBottom with an active turn above the tail slides the window to keep it visible", () => {
  // §A.5's literal tail branch (i0 = max(0, n - cap)) would exclude activeIdx
  // here, contradicting the same section's "the activeIdx turn is never
  // excluded" promise. The window keeps its cap length and slides to
  // [anchor, anchor + cap) precisely in that case.
  const lay = layoutRows(12, 4, 0, 1, true);
  expect(lay.windowed).toBe(true);
  expect(lay.i0).toBe(1);
  expect(lay.i1).toBe(5);
  expect(lay.slots).toEqual([0, 1, 2, 3]);

  // ...while every in-tail anchor still yields the untouched sticky tail.
  expect(layoutRows(12, 4, 0, 8, true).i0).toBe(8);
  expect(layoutRows(12, 4, 0, 11, true).i0).toBe(8);
});

test("layoutRows edge cases: n = 1 and A = 1", () => {
  expect(layoutRows(1, 1, 0, 0, false)).toEqual({ slots: [0], i0: 0, i1: 1, step: 1, windowed: false });
  expect(layoutRows(1, 1, 0, 0, true)).toEqual({ slots: [0], i0: 0, i1: 1, step: 1, windowed: false });

  expect(layoutRows(3, 1, 0, 1, false)).toEqual({ slots: [0], i0: 1, i1: 2, step: 1, windowed: true });
  expect(layoutRows(3, 1, 0, 2, false)).toEqual({ slots: [0], i0: 2, i1: 3, step: 1, windowed: true });
  expect(layoutRows(3, 1, 0, 0, true)).toEqual({ slots: [0], i0: 0, i1: 1, step: 1, windowed: true });
  expect(layoutRows(3, 1, 0, 2, true)).toEqual({ slots: [0], i0: 2, i1: 3, step: 1, windowed: true });
});

// ---------------------------------------------------------------------------
// buildRailRows + hitAt — the shared render/hit-test geometry
// ---------------------------------------------------------------------------

test("buildRailRows: one row per absolute rail row; fit ticks sit at the layout slots", () => {
  const lay = layoutRows(2, 5, 0, 1, false); // A = 5, n = 2 -> step 2, slots [1, 3]
  expect(lay.slots).toEqual([1, 3]);

  const rows = buildRailRows({
    height: 5,
    chev: 0,
    layout: lay,
    activeIdx: 1,
    hoverIdx: null,
    jumpedIdx: null,
    hasUp: true,
    hasDown: false,
  });

  expect(rows.length).toBe(5);
  rows.forEach((r, i) => expect(r.row).toBe(i));
  expect(rows.map((r) => r.kind)).toEqual(["blank", "tick", "blank", "tick", "blank"]);
  expect(rows[1].turnIdx).toBe(0);
  expect(rows[3].turnIdx).toBe(1);
  expect(rows[1].glyph).toBe("·");
  expect(rows[1].tone).toBe("rail");
  expect(rows[3].glyph).toBe("▌"); // active
  expect(rows[3].tone).toBe("accent");
  expect(rows[0]).toEqual({ row: 0, kind: "blank", turnIdx: -1, glyph: " ", tone: "muted" });
});

test("buildRailRows: chevrons occupy the first / last rows and reflect hasUp / hasDown", () => {
  const lay = layoutRows(2, 7, 2, 0, false); // A = 5 -> slots [1, 3] -> absolute rows 2 and 4
  const rows = buildRailRows({
    height: 7,
    chev: 2,
    layout: lay,
    activeIdx: 0,
    hoverIdx: null,
    jumpedIdx: null,
    hasUp: false,
    hasDown: true,
  });

  expect(rows.length).toBe(7);
  expect(rows[0]).toEqual({ row: 0, kind: "up", turnIdx: -1, glyph: "↑", tone: "muted" });
  expect(rows[6]).toEqual({ row: 6, kind: "down", turnIdx: -1, glyph: "↓", tone: "fg" });
  expect(rows.map((r) => r.kind)).toEqual(["up", "blank", "tick", "blank", "tick", "blank", "down"]);
  expect(rows[2].turnIdx).toBe(0);
  expect(rows[4].turnIdx).toBe(1);
  expect(rows[2].glyph).toBe("▌"); // active
  expect(rows[4].glyph).toBe("·");

  const flipped = buildRailRows({
    height: 7,
    chev: 2,
    layout: lay,
    activeIdx: -1,
    hoverIdx: null,
    jumpedIdx: null,
    hasUp: true,
    hasDown: false,
  });
  expect(flipped[0].tone).toBe("fg");
  expect(flipped[6].tone).toBe("muted");
});

test("buildRailRows: glyph/tone priority is active > jumped > hovered > plain", () => {
  const layout = layoutRows(4, 4, 0, 0, false); // A = 4, n = 4 -> step 1, slots [0, 1, 2, 3]
  expect(layout.slots).toEqual([0, 1, 2, 3]);

  const rows = buildRailRows({
    height: 4,
    chev: 0,
    layout,
    activeIdx: 0,
    hoverIdx: 3,
    jumpedIdx: 1,
    hasUp: false,
    hasDown: false,
  });
  expect(rows[0].glyph).toBe("▌"); // active wins
  expect(rows[0].tone).toBe("accent");
  expect(rows[1].glyph).toBe("┃"); // jumped
  expect(rows[1].tone).toBe("accent");
  expect(rows[2].glyph).toBe("·"); // plain
  expect(rows[2].tone).toBe("rail");
  expect(rows[3].glyph).toBe("│"); // hovered
  expect(rows[3].tone).toBe("fg");

  // active beats jumped beats hovered when they collide on one row
  const collide = buildRailRows({
    height: 4,
    chev: 0,
    layout,
    activeIdx: 1,
    hoverIdx: 1,
    jumpedIdx: 1,
    hasUp: false,
    hasDown: false,
  });
  expect(collide[1].glyph).toBe("▌");
  expect(collide[1].tone).toBe("accent");
});

test("buildRailRows: windowed layout renders contiguous ticks from layout.i0", () => {
  const lay = layoutRows(12, 5, 0, 11, true); // n > A -> sticky tail [7, 12)
  expect(lay.i0).toBe(7);

  const rows = buildRailRows({
    height: 5,
    chev: 0,
    layout: lay,
    activeIdx: 11,
    hoverIdx: null,
    jumpedIdx: 8,
    hasUp: true,
    hasDown: false,
  });
  expect(rows.map((r) => r.kind)).toEqual(["tick", "tick", "tick", "tick", "tick"]);
  expect(rows.map((r) => r.turnIdx)).toEqual([7, 8, 9, 10, 11]);
  expect(rows[4].glyph).toBe("▌"); // active (turn 11)
  expect(rows[1].glyph).toBe("┃"); // jumped (turn 8)
});

test("buildRailRows: rows.length === height for every height; no turns => body rows blank", () => {
  for (let H = 0; H <= 10; H++) {
    for (const chev of [0, 2]) {
      const lay = layoutRows(0, H, chev, -1, false);
      const rows = buildRailRows({
        height: H,
        chev,
        layout: lay,
        activeIdx: -1,
        hoverIdx: null,
        jumpedIdx: null,
        hasUp: false,
        hasDown: false,
      });
      expect(rows.length).toBe(H);
      rows.forEach((r, i) => {
        expect(r.row).toBe(i);
        if (chev === 0 || (i > 0 && i < H - 1)) expect(r.kind).toBe("blank");
        if (r.kind === "blank") expect(r.turnIdx).toBe(-1);
      });
    }
  }
});

test("hitAt: literal row index; null for blank/out-of-range; every rendered slot round-trips", () => {
  for (const chev of [0, 2]) {
    for (let A = 1; A <= 8; A++) {
      const H = A + chev;
      for (let n = 0; n <= A + 4; n++) {
        for (const atBottom of [false, true]) {
          const activeIdxs = n === 0 ? [-1] : [-1, 0, Math.floor(n / 2), n - 1];
          for (const activeIdx of activeIdxs) {
            const lay = layoutRows(n, H, chev, activeIdx, atBottom);
            const rows = buildRailRows({
              height: H,
              chev,
              layout: lay,
              activeIdx,
              hoverIdx: null,
              jumpedIdx: null,
              hasUp: true,
              hasDown: true,
            });
            expect(rows.length).toBe(H);

            for (let r = 0; r < H; r++) {
              const hit = hitAt(r, rows);
              if (rows[r].kind === "blank") expect(hit).toBeNull();
              else expect(hit).toBe(rows[r]);
            }
            expect(hitAt(-1, rows)).toBeNull();
            expect(hitAt(H, rows)).toBeNull();

            // Round-trip: slot k -> absolute row -> turn (layout.i0 + k).
            const bodyOffset = chev > 0 ? 1 : 0;
            for (let k = 0; k < lay.slots.length; k++) {
              const r = bodyOffset + lay.slots[k];
              const hit = hitAt(r, rows);
              expect(hit).not.toBeNull();
              expect(hit?.kind).toBe("tick");
              expect(hit?.turnIdx).toBe(lay.i0 + k);
              expect(hit?.row).toBe(r);
            }
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// computeNav — nav targets (§A.5) and the inferred fallbacks (§A.2)
// ---------------------------------------------------------------------------

test("computeNav: n = 0 yields no anchors, atBottom passes through", () => {
  expect(computeNav([], [], 0, 0, true)).toEqual({
    activeIdx: -1,
    upIndex: null,
    upInferred: false,
    downIndex: null,
    downInferred: false,
    atBottom: true,
  });
  expect(computeNav([], [], 0, 0, false).atBottom).toBe(false);
});

test("computeNav: active is the last mounted turn with top <= viewTop; up/down use the measured neighbours", () => {
  const ts = makeTurns(5);
  const all = makeItems([
    [0, 0],
    [1, 10],
    [2, 20],
    [3, 30],
    [4, 40],
  ]);

  const nav = computeNav(ts, all, 25, 40, false);
  expect(nav.activeIdx).toBe(2);
  expect(nav.upIndex).toBe(2);
  expect(nav.upInferred).toBe(false);
  expect(nav.downIndex).toBe(3);
  expect(nav.downInferred).toBe(false);
  expect(nav.atBottom).toBe(false);

  // viewport at the very top: active is turn 0 and there is nothing above it
  const top = computeNav(ts, all, 0, 40, false);
  expect(top.activeIdx).toBe(0);
  expect(top.upIndex).toBeNull();
  expect(top.upInferred).toBe(false);
  expect(top.downIndex).toBe(1);
  expect(top.downInferred).toBe(false);
});

test("computeNav: unmounted active falls back to the nearest ordinal (flagged)", () => {
  const ts = makeTurns(5);
  const mounted = makeItems([
    [3, 30],
    [4, 40],
  ]);

  const nav = computeNav(ts, mounted, 25, 40, false);
  expect(nav.activeIdx).toBe(2); // max(0, firstMounted.i - 1)
  expect(nav.upIndex).toBe(2);
  expect(nav.upInferred).toBe(true);
  expect(nav.downIndex).toBe(3);
  expect(nav.downInferred).toBe(false);
});

test("computeNav: nothing mounted -> active 0 off-bottom, last turn at sticky bottom", () => {
  const ts = makeTurns(5);

  const nav = computeNav(ts, [], 25, 40, false);
  expect(nav.activeIdx).toBe(0);
  expect(nav.upIndex).toBeNull();
  expect(nav.upInferred).toBe(false);
  expect(nav.downIndex).toBe(4);
  expect(nav.downInferred).toBe(true);

  const bottom = computeNav(ts, [], 25, 40, true);
  expect(bottom.activeIdx).toBe(4);
  expect(bottom.upIndex).toBeNull();
  expect(bottom.downIndex).toBeNull();
  expect(bottom.downInferred).toBe(false);
  expect(bottom.atBottom).toBe(true);
});

test("computeNav: down accepts a measured top at most maxScroll + 1 past viewTop", () => {
  const ts = makeTurns(4);
  const mounted = makeItems([[2, 40]]); // e.g. a measured top already clamped to maxScroll

  const measured = computeNav(ts, mounted, 25, 39, false); // maxScroll + 1 = 40 -> accepted
  expect(measured.downIndex).toBe(2);
  expect(measured.downInferred).toBe(false);
  expect(measured.activeIdx).toBe(1);

  const inferred = computeNav(ts, mounted, 25, 38, false); // 39 < 40 -> rejected, n - 1 inferred
  expect(inferred.downIndex).toBe(3);
  expect(inferred.downInferred).toBe(true);
  expect(inferred.activeIdx).toBe(1);
});

test("computeNav: viewTop equal to a measured top counts as active (<=, not <)", () => {
  const ts = makeTurns(4);
  const mounted = makeItems([
    [0, 0],
    [1, 15],
    [2, 30],
  ]);

  const nav = computeNav(ts, mounted, 30, 50, false);
  expect(nav.activeIdx).toBe(2);
  expect(nav.upIndex).toBe(1); // strict <: turn 2's own top does not count as "up"
  expect(nav.upInferred).toBe(false);
  expect(nav.downIndex).toBe(3); // nothing measured below viewTop -> n - 1 inferred
  expect(nav.downInferred).toBe(true);
});

test("computeNav: unknown ids are ignored and item order does not matter", () => {
  const ts = makeTurns(3);
  const shuffled = [
    { id: "ghost", top: 5 },
    { id: "t2", top: 30 },
    { id: "t0", top: 0 },
    { id: "t1", top: 15 },
  ];

  const nav = computeNav(ts, shuffled, 16, 30, false);
  expect(nav.activeIdx).toBe(1);
  expect(nav.upIndex).toBe(1);
  expect(nav.downIndex).toBe(2);
  expect(nav.downInferred).toBe(false);
});

test("computeNav: scrolled below every measured turn -> active is the last mounted", () => {
  const ts = makeTurns(6);
  const mounted = makeItems([
    [4, 100],
    [5, 120],
  ]);

  const nav = computeNav(ts, mounted, 180, 150, false);
  expect(nav.activeIdx).toBe(5);
  expect(nav.upIndex).toBe(5);
  expect(nav.upInferred).toBe(false);
  expect(nav.downIndex).toBe(5); // nothing below; n - 1 inferred
  expect(nav.downInferred).toBe(true);

  const bottom = computeNav(ts, mounted, 180, 150, true);
  expect(bottom.activeIdx).toBe(5);
  expect(bottom.downIndex).toBeNull();
  expect(bottom.downInferred).toBe(false);
});

test("computeNav: sticky bottom pins active to the last turn even if only earlier users are mounted", () => {
  const ts = makeTurns(8);
  const mounted = makeItems([
    [2, 40],
    [3, 80],
  ]);
  const nav = computeNav(ts, mounted, 200, 199, true);
  expect(nav.activeIdx).toBe(7);
  expect(nav.downIndex).toBeNull();
});

test("computeNav: up inference never goes negative", () => {
  const ts = makeTurns(3);
  const nav = computeNav(ts, makeItems([[0, 0]]), 0, 30, false);
  expect(nav.activeIdx).toBe(0);
  expect(nav.upIndex).toBeNull(); // no measured top < viewTop, and turn 0 has no predecessor
  expect(nav.upInferred).toBe(false);
  expect(nav.downIndex).toBe(2); // no measured top in (0, 31] -> n - 1 inferred
  expect(nav.downInferred).toBe(true);
});

// ---------------------------------------------------------------------------
// charW / strW / takeW / truncateWrapped — CJK-width-aware text fitting (§E.3)
// ---------------------------------------------------------------------------

test("charW: 1 column up to U+00FF, 2 above", () => {
  expect(charW("a")).toBe(1);
  expect(charW("\u00ff")).toBe(1); // ÿ
  expect(charW("\u0100")).toBe(2); // Ā
  expect(charW("中")).toBe(2);
  expect(charW("你")).toBe(2);
  expect(charW("€")).toBe(2); // U+20AC
  expect(charW("😀")).toBe(2); // U+1F600
  expect(charW("𠀀")).toBe(2); // U+20000
});

test("strW: sum of code-point widths", () => {
  expect(strW("")).toBe(0);
  expect(strW("abc")).toBe(3);
  expect(strW("中文")).toBe(4);
  expect(strW("a中b")).toBe(4);
});

test("takeW: longest prefix that fits; a wide char at the boundary is not split", () => {
  expect(takeW("abcdef", 3)).toBe("abc");
  expect(takeW("abcdef", 0)).toBe("");
  expect(takeW("中中中", 5)).toBe("中中");
  expect(takeW("中中中", 6)).toBe("中中中");
  expect(takeW("a中", 2)).toBe("a");
  expect(takeW("a中", 3)).toBe("a中");
  expect(takeW("中", 1)).toBe("");
});

test("truncateWrapped: wraps on width, preserves newlines, respects maxLines, appends … when truncating", () => {
  expect(truncateWrapped("", 10, 3)).toEqual([""]);
  expect(truncateWrapped("hello", 10, 3)).toEqual(["hello"]);
  expect(truncateWrapped("a\nb", 5, 3)).toEqual(["a", "b"]);
  expect(truncateWrapped("abcdefgh", 5, 1)).toEqual(["abc…"]);
  expect(truncateWrapped("abcdef", 3, 3)).toEqual(["abc", "d…"]);
  expect(truncateWrapped("aaaa\nbbbb\ncccc", 4, 2)).toEqual(["aaaa", "bb…"]);
  expect(truncateWrapped("abcdef", 5, 0)).toEqual([]); // maxLines <= 0 emits nothing
});

test("truncateWrapped: a wide char straddling the boundary moves to the next line intact", () => {
  const lines = truncateWrapped("ab你cd", 3, 3);
  expect(lines).toEqual(["ab", "你c", "d"]);
  expect(lines.join("")).toBe("ab你cd"); // nothing lost, nothing split
  expect(lines.every((l) => strW(l) <= 3)).toBe(true);

  // The ellipsis itself is measured as 2 columns (U+2026 > U+00FF), so a
  // 3-column budget leaves room for it only after dropping to 1 column of text.
  expect(charW("…")).toBe(2);
  expect(truncateWrapped("ab你cd", 3, 2)).toEqual(["ab", "…"]);
  expect(truncateWrapped("ab你cd", 3, 1)).toEqual(["a…"]);
});

test("truncateWrapped: a last line at the width limit is ellipsized (declared conservative rule)", () => {
  // §E.3's rule is `strW(last) >= width - 1`, not an exact truncation flag:
  // a full-ish last line gets … even when nothing was dropped.
  expect(truncateWrapped("abcd", 5, 3)).toEqual(["abc…"]);
});

test("truncateWrapped: no emitted line ever exceeds the width (ASCII and CJK)", () => {
  const samples = [
    "hello world",
    "你好世界这是一个很长的句子",
    "a中b文c字d",
    "中",
    "😀😀😀",
    "aa中bb文cc",
    "x".repeat(50),
    "first line\nsecond 中文 line\nthird",
  ];

  for (const s of samples) {
    for (let width = 2; width <= 12; width++) {
      for (let maxLines = 1; maxLines <= 4; maxLines++) {
        const lines = truncateWrapped(s, width, maxLines);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(maxLines);
        for (const line of lines) expect(strW(line)).toBeLessThanOrEqual(width);
      }
    }
  }

  // width = 1 is only satisfiable for single-column glyphs; assert it for ASCII.
  for (const s of ["abc", "abcdef"]) {
    for (const line of truncateWrapped(s, 1, 3)) expect(strW(line)).toBeLessThanOrEqual(1);
  }
});
