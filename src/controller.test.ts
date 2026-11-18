/**
 * Controller behaviour against a FAKE host — no TUI, no terminal.
 *
 * What is pinned here (everything the pty harness would otherwise be the only
 * proof of):
 *   - the hover card anchors to the row the rail actually painted, and follows
 *     that tick when the window slides (§E.2);
 *   - the card closes only when its turn leaves the window;
 *   - one pointer sink serves both sources, so a duplicated click cannot fire
 *     two jumps, and the SGR fallback retires once native events resolve rows;
 *   - a jump prefers the host's `scrollChildIntoView(id, { align: "start" })`
 *     rung when the build provides it.
 *
 * Runner note: `npm test` passes `--conditions=browser`, because solid-js's `node`
 * export condition resolves to its SSR build where `createMemo` never invalidates.
 *
 * Host constraints encoded in the fixture (see docs/design.md Gate findings):
 * `getChildren()`-less scrollboxes are fine, `viewport` is the box's own screen
 * rect, children `y` is screen-relative and `measure` recovers the content
 * offset as `scrollTop + y - viewport.y`.
 */
import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import type { Context } from "@opencode/plugin/tui/context";
import { createRail, type RailController, type Settings } from "./controller.js";
import { anchorTop, tickRow } from "./geom.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SETTINGS: Settings = { enabled: true, wheelLines: 3, dwellMs: 0 };

interface Fixture {
  rail: RailController;
  dispose: () => void;
  /** Rail geometry, so tests can address rows without re-deriving it. */
  geo: { railLeft: number; railTop: number; gutter: number; height: number };
  scroll: { top: number };
  intoView: Array<{ id: string; options?: { align?: string } }>;
  dispatches: string[];
  emitSgr: (sequence: string) => void;
  stdinListeners: () => number;
}

/**
 * `turns` user messages on a 10-row pitch, a 20-row viewport, and the rail's
 * 2-column gutter at the transcript's right edge.
 */
function makeFixture(options: { turns: number; viewportHeight?: number; scrollTop?: number }): Fixture {
  const height = options.viewportHeight ?? 20;
  const width = 56;
  const pitch = 10;
  const contentH = options.turns * pitch;
  const state = { scrollTop: options.scrollTop ?? 0 };
  const viewport = { x: 2, y: 1, width, height };

  const parent: any = { screenX: 2, screenY: 0, width: width + 2, height: height + 1, children: [], parent: null };
  const intoView: Fixture["intoView"] = [];

  const scrollbox: any = {
    // Screen-relative child rows, exactly what the host's messagePositions() sees.
    get children() {
      return Array.from({ length: options.turns }, (_, i) => ({
        id: `msg_${i}`,
        y: i * pitch - state.scrollTop + viewport.y,
      }));
    },
    get scrollTop() {
      return state.scrollTop;
    },
    set scrollTop(v: number) {
      state.scrollTop = v;
    },
    scrollHeight: contentH,
    viewport,
    verticalScrollBar: { on() {}, off() {} },
    height,
    width,
    parent,
    screenX: 2,
    screenY: 1,
    stickyStart: "bottom",
    stickyScroll: true,
    scrollTo(position: number | { x: number; y: number }) {
      state.scrollTop = typeof position === "number" ? position : position.y;
    },
    scrollBy(delta: number | { x: number; y: number }) {
      state.scrollTop += typeof delta === "number" ? delta : delta.y;
    },
    // 0.8.4+: alignment-aware, then re-applies after layout.
    scrollChildIntoView(id: string, opts?: { align?: string }) {
      intoView.push({ id, options: opts });
      const index = Number(id.slice("msg_".length));
      if (Number.isFinite(index)) state.scrollTop = Math.max(0, Math.min(contentH - height, index * pitch));
    },
    // 0.8.4+: runs in the next frame, after layout.
    afterLayout(cb: () => void) {
      setTimeout(cb, 0);
    },
  };

  const root: any = { children: [parent], parent: null };
  parent.children = [scrollbox];
  parent.parent = root;

  const stdin = new (class {
    private handlers: Array<(chunk: Buffer) => void> = [];
    on(_event: string, handler: (chunk: Buffer) => void) {
      this.handlers.push(handler);
      return this;
    }
    off(_event: string, handler: (chunk: Buffer) => void) {
      this.handlers = this.handlers.filter((h) => h !== handler);
      return this;
    }
    listenerCount() {
      return this.handlers.length;
    }
    emit(chunk: string) {
      for (const handler of this.handlers) handler(Buffer.from(chunk, "utf8"));
    }
  })();

  const dispatches: string[] = [];
  const messages = Array.from({ length: options.turns }, (_, i) => ({
    id: `msg_${i}`,
    type: "user",
    text: `turn ${i}`,
    time: { created: 1_000 + i },
  }));

  const ctx: any = {
    options: {},
    location: undefined,
    app: { version: "test", channel: "test" },
    renderer: { root, width: 80, height: 24, on() {}, off() {}, requestRender() {}, stdin },
    client: { message: { list: async () => ({ data: [], cursor: { next: null } }) } },
    data: {
      session: {
        message: { list: () => messages, more: () => false, loading: () => false, loadMore: async () => {} },
        get: () => undefined,
      },
      listen: () => () => {},
    },
    theme: {},
    themeMode: "dark",
    keymap: { dispatch: (id: string) => void dispatches.push(id) },
    storage: { store: () => [{}, async () => {}], memory: () => [{}, () => {}] },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "s1" }) },
      toast: { show: () => {} },
      slot: () => () => {},
    },
    attention: { notify: async () => ({ ok: true, notification: false, sound: false }) },
    markdown: { registerCodeBlockRenderer: () => () => {} },
  };

  let rail!: RailController;
  const disposeRoot = createRoot((dispose) => {
    rail = createRail(ctx as unknown as Context, SETTINGS);
    rail.tick();
    return dispose;
  });

  return {
    rail,
    dispose: () => {
      rail.dispose();
      disposeRoot();
    },
    // geomFrom: railLeft = screenX + width, gutter = parent right − railLeft.
    geo: { railLeft: 2 + width, railTop: 1, gutter: 2, height },
    scroll: {
      get top() {
        return state.scrollTop;
      },
      set top(v: number) {
        state.scrollTop = v;
      },
    },
    intoView,
    dispatches,
    emitSgr: (sequence: string) => stdin.emit(sequence),
    stdinListeners: () => stdin.listenerCount(),
  };
}

/** SGR fields are 1-based; the parser subtracts one. */
const sgr = (code: number, x: number, y: number, press: "M" | "m") => `\x1b[<${code};${x + 1};${y + 1}${press}`;

// ---------------------------------------------------------------------------

test("card anchors to the painted tick row, not to the ordinal (fit layout)", async () => {
  const f = makeFixture({ turns: 5 });
  try {
    const view = f.rail.view();
    expect(view.tier).toBe(3);
    expect(view.windowed).toBe(false);

    // Hover the middle tick (turn 2). Its row comes from the sparse fit layout.
    const row = tickRow(view.rows, 2)!;
    expect(row).not.toBe(1 + (2 - view.i0)); // the old ordinal derivation would be wrong
    f.rail.pointer.move(f.geo.railTop + row);
    await sleep(5);

    const card = f.rail.view().card!;
    expect(card).not.toBeNull();
    expect(f.rail.debug().cardIdx).toBe(2);
    expect(card.top).toBe(anchorTop(row, card.h, view.height));
    expect(card.top).toBeGreaterThan(row - card.h);
    expect(card.top).toBeLessThanOrEqual(row);
  } finally {
    f.dispose();
  }
});

test("card follows its tick when the window slides, and closes only when the turn leaves it", async () => {
  const f = makeFixture({ turns: 40, scrollTop: 100 });
  try {
    f.rail.tick();
    const first = f.rail.view();
    expect(first.windowed).toBe(true);
    expect(first.tier).toBe(3);

    const hoverIdx = 12;
    const rowA = tickRow(first.rows, hoverIdx)!;
    f.rail.pointer.move(f.geo.railTop + rowA);
    await sleep(5);
    expect(f.rail.debug().cardIdx).toBe(hoverIdx);
    const cardA = f.rail.view().card!;

    // Scroll two turns' worth: the window slides, so the same tick moves.
    f.scroll.top = 140;
    f.rail.tick();
    const second = f.rail.view();
    expect(second.i0).toBe(first.i0 + 4);

    const rowB = tickRow(second.rows, hoverIdx)!;
    expect(rowB).not.toBe(rowA);
    const cardB = second.card!;
    expect(f.rail.debug().cardIdx).toBe(hoverIdx); // still open, still that turn
    expect(cardB.top).not.toBe(cardA.top); // …and it moved with the tick
    expect(cardB.top).toBe(anchorTop(rowB, cardB.h, second.height));

    // Jump to the end: the turn is out of the window → the card closes.
    f.scroll.top = 400 - f.geo.height;
    f.rail.tick();
    expect(f.rail.debug().cardIdx).toBeNull();
    expect(f.rail.view().card).toBeNull();
  } finally {
    f.dispose();
  }
});

test("one pointer sink: a duplicate click from the second source does not fire twice", async () => {
  const f = makeFixture({ turns: 5 });
  try {
    const row = tickRow(f.rail.view().rows, 3)!;
    const y = f.geo.railTop + row;

    // Both sources deliver the same physical click; only one jump may run.
    f.rail.pointer.down(y);
    f.rail.pointer.down(y);
    f.rail.pointer.up(y, 0);
    f.rail.pointer.up(y, 0);
    await sleep(40);

    expect(f.intoView.length).toBe(1);
    expect(f.intoView[0].id).toBe("msg_3");
    expect(f.intoView[0].options?.align).toBe("start");
    expect(f.rail.debug().jumpRung).toBe("direct");
  } finally {
    f.dispose();
  }
});

test("SGR fallback still clicks, and native events retire it once they resolve a row", async () => {
  const f = makeFixture({ turns: 5 });
  try {
    const view = f.rail.view();
    const row = tickRow(view.rows, 1)!;
    const y = f.geo.railTop + row;
    const x = f.geo.railLeft;

    expect(f.stdinListeners()).toBe(1);
    expect(f.rail.debug().pointerSource).toBeNull();

    // Real SGR: press + release on that tick.
    f.emitSgr(sgr(0, x, y, "M"));
    f.emitSgr(sgr(0, x, y, "m"));
    expect(f.rail.debug().pointerSource).toBe("sgr");
    await sleep(40);
    expect(f.intoView.map((c) => c.id)).toEqual(["msg_1"]);
    expect(f.stdinListeners()).toBe(1); // SGR alone never retires itself

    // A blank row must not be taken as proof the native path works.
    const blank = view.rows.find((r) => r.kind === "blank")!;
    f.rail.pointer.native(f.geo.railTop + blank.row);
    expect(f.rail.debug().pointerSource).toBe("sgr");
    expect(f.stdinListeners()).toBe(1);

    // A real row is proof: latch native and drop the stdin parser.
    f.rail.pointer.native(y);
    expect(f.rail.debug().pointerSource).toBe("native");
    expect(f.stdinListeners()).toBe(0);
  } finally {
    f.dispose();
  }
});

test("pointer targets outside the rail band are ignored (no hover, no jump)", async () => {
  const f = makeFixture({ turns: 5 });
  try {
    f.rail.pointer.move(0); // above the rail (railTop is 1)
    f.rail.pointer.down(0);
    f.rail.pointer.up(0, 0);
    f.rail.pointer.move(f.geo.railTop + f.geo.height); // one row past the band
    await sleep(10);

    expect(f.rail.debug().cardIdx).toBeNull();
    expect(f.rail.debug().hoverIdx).toBeNull();
    expect(f.intoView).toEqual([]);
  } finally {
    f.dispose();
  }
});

test("wheel: one notch reaching both sources scrolls once; same-source notches all count", () => {
  const f = makeFixture({ turns: 40, scrollTop: 100 });
  try {
    f.rail.tick();
    const x = f.geo.railLeft;
    const y = f.geo.railTop + 5;
    const before = f.scroll.top;

    // Native notch (JSX onMouseScroll) moves the transcript by wheelLines.
    f.rail.wheel({ scroll: { direction: "down", delta: 1 } } as any);
    const afterNative = f.scroll.top;
    expect(afterNative).toBe(before + 3);

    // The same physical notch arriving again as SGR must be coalesced…
    f.emitSgr(sgr(65, x, y, "M"));
    expect(f.scroll.top).toBe(afterNative);

    // …while consecutive native notches are never dropped.
    f.rail.wheel({ scroll: { direction: "down", delta: 1 } } as any);
    expect(f.scroll.top).toBe(afterNative + 3);
  } finally {
    f.dispose();
  }
});
