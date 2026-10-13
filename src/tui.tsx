/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import type { JSX } from "@opentui/solid";
import { createRoot } from "solid-js";
import { writeFileSync } from "node:fs";
import type { MouseEvent } from "@opentui/core";
import { createRail, type RailController } from "./controller";
import { hitAt } from "./geom";
import { toneColor } from "./theme";

export default Plugin.define({
  id: "opencode-message-rail",

  setup(context: Context) {
    let stopRail: (() => void) | undefined;
    try {
      stopRail = startRail(context);
    } catch {
      // never throw into the host: a broken rail degrades to "no rail", never "no TUI"
    }

    return () => {
      try {
        stopRail?.();
      } catch {
        /* ignore */
      }
    };
  },
});

/**
 * The real plugin half: options → settings, the controller, the `app` slot claim
 * (rail + keymap layer) and the `debugFile` channel. Returns one cleanup that
 * releases every resource; every host call inside is guarded so this can never
 * throw into the host.
 */
function startRail(context: Context): () => void {
  // ---- options (opencode.json → plugins[].options) -----------------------
  const optionsEnabled = context.options.enabled !== false;
  const wheelLines = typeof context.options.wheelLines === "number" ? context.options.wheelLines : 3;
  const dwellMs = typeof context.options.dwellMs === "number" ? context.options.dwellMs : 120;

  // Durable toggle (survives restarts and stays live-synced across TUI instances).
  const [prefs, updatePrefs] = context.storage.store("prefs", { initial: { enabled: true } });

  // Latched toast helper — a failing probe must not be able to spam the toast channel.
  const seen = new Map<string, number>();
  const toastOnce = (message: string, variant: "warning" | "error" = "warning") => {
    const now = Date.now();
    if ((seen.get(message) ?? 0) > now) return;
    seen.set(message, now + 5_000);
    try {
      context.ui.toast.show({ message, variant });
    } catch {
      /* ignore */
    }
  };

  // Stable owner for createRail's signals/memos/timers. Host slot render is
  // one-shot, so later T3 updates are written onto the nodes captured below.
  const settings = {
    get enabled() {
      return optionsEnabled && prefs.enabled;
    },
    wheelLines,
    dwellMs,
  };
  let rail!: RailController;
  const disposeRoot = createRoot((dispose) => {
    rail = createRail(context, settings, toastOnce);
    rail.tick();
    return dispose;
  });

  const onToggle = async () => {
    const next = !prefs.enabled;
    try {
      await updatePrefs((draft) => {
        draft.enabled = next;
      });
    } catch {
      /* ignore */
    }
    try {
      context.ui.toast.show({ message: next ? "Message rail: shown" : "Message rail: hidden", variant: "warning" });
    } catch {
      /* ignore */
    }
  };

  // Keymap lives in `app` (no visual). The rail overlay is claimed on
  // `session.composer.top` — the only slot that paints plugin JSX on 2.0.19
  // (`app` absolute overlays are 0 pixels; `sidebar.content` is occupied by
  // opencode-user-timeline).
  const disposeApp = context.ui.slot({
    append: "app",
    render: () => <RailKeymap ctl={rail} onToggle={onToggle} />,
  });
  // `session.composer.top` is the only slot that paints plugin JSX on 2.0.19.
  // Overlay is taken out of flow (0×0 host) so it does not shove the composer.
  type PaintNode = {
    content?: unknown;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    screenX?: number;
    screenY?: number;
    zIndex?: number;
    fg?: string;
    backgroundColor?: string;
    visible?: boolean;
  };
  const TICK_CAP = 120;
  const CARD_LINE_CAP = 3;
  let hostNode: PaintNode | undefined;
  let railNode: PaintNode | undefined;
  let cardNode: PaintNode | undefined;
  let cardHeaderNode: PaintNode | undefined;
  const tickNodes: PaintNode[] = [];
  const cardLineNodes: PaintNode[] = [];
  let lastPaintKey = "";
  let downRow: number | null = null;
  const rowAt = (y: number) => {
    const v = rail.view();
    return hitAt(y - v.railTop, v.rows);
  };
  const steal = (e: MouseEvent) => {
    e.stopPropagation();
    if (typeof (e as { preventDefault?: () => void }).preventDefault === "function") {
      (e as { preventDefault: () => void }).preventDefault();
    }
  };
  const paintRail = (): boolean => {
    if (!railNode) return false;
    try {
      const v = rail.view();
      const visible = v.tier >= 2 && v.height > 0 && v.rows.length > 0;
      const hx = hostNode?.screenX ?? 0;
      const hy = hostNode?.screenY ?? 0;
      const glyphs = visible ? v.rows.map((row) => row.glyph + row.tone).join("") : "";
      const card = visible ? v.card : null;
      const key = [
        v.tier,
        v.railLeft,
        v.railTop,
        v.gutter,
        v.height,
        hx,
        hy,
        glyphs,
        card ? `${card.top}:${card.w}:${card.h}:${card.header}` : "",
      ].join("|");
      if (key === lastPaintKey) return false;
      lastPaintKey = key;
      railNode.left = v.railLeft - hx;
      railNode.top = v.railTop - hy;
      railNode.width = Math.max(1, v.gutter);
      railNode.height = visible ? v.height : 0;
      railNode.zIndex = 900;
      for (let i = 0; i < TICK_CAP; i++) {
        const node = tickNodes[i];
        if (!node) continue;
        const row = visible ? v.rows[i] : undefined;
        if (!row) {
          node.content = "";
          node.height = 0;
          node.visible = false;
          continue;
        }
        node.visible = true;
        node.content = row.glyph;
        node.height = 1;
        node.fg = toneColor(row.tone, rail.colors);
      }
      if (cardNode) {
        if (!card) {
          cardNode.width = 0;
          cardNode.height = 0;
          cardNode.visible = false;
          if (cardHeaderNode) cardHeaderNode.content = "";
          for (const line of cardLineNodes) line.content = "";
        } else {
          cardNode.visible = true;
          // Sibling of the rail, positioned from the 0×0 host. Nested inside
          // the 2-col rail box, negative `left` is clipped even with overflow.
          cardNode.left = v.railLeft - hx - (card.w + 1);
          cardNode.top = v.railTop - hy + card.top;
          cardNode.width = card.w;
          cardNode.height = card.h;
          cardNode.zIndex = 901;
          cardNode.backgroundColor = rail.colors.background;
          if (cardHeaderNode) {
            cardHeaderNode.content = card.header;
            cardHeaderNode.fg = rail.colors.muted;
          }
          for (let i = 0; i < CARD_LINE_CAP; i++) {
            const node = cardLineNodes[i];
            if (!node) continue;
            node.content = card.lines[i] ?? "";
            node.fg = rail.colors.foreground;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  };
  const disposeSidebar = context.ui.slot({
    append: "session.composer.top",
    render: () => (
      <box
        ref={(el: unknown) => {
          hostNode = el as PaintNode;
        }}
        width={0}
        height={0}
        flexShrink={0}
        overflow="visible"
      >
        <box
          ref={(el: unknown) => {
            railNode = el as PaintNode;
          }}
          position="absolute"
          width={2}
          height={1}
          flexDirection="column"
          overflow="visible"
          zIndex={900}
          onMouseMove={(e: MouseEvent) => {
            steal(e);
            rail.hoverRow(rowAt(e.y));
          }}
          onMouseOver={(e: MouseEvent) => {
            steal(e);
            rail.hoverRow(rowAt(e.y));
          }}
          onMouseOut={(e: MouseEvent) => {
            steal(e);
            rail.dismissCard();
          }}
          onMouseDown={(e: MouseEvent) => {
            steal(e);
            rail.dismissCard();
            downRow = rowAt(e.y)?.row ?? null;
          }}
          onMouseUp={(e: MouseEvent) => {
            steal(e);
            const r = rowAt(e.y);
            if (e.button === 0 && r && downRow === r.row && r.kind !== "blank") {
              rail.activate({ kind: r.kind, turnIdx: r.turnIdx });
            }
            downRow = null;
          }}
          onMouseScroll={(e: MouseEvent) => {
            steal(e);
            rail.wheel(e);
          }}
        >
          {Array.from({ length: TICK_CAP }, (_, i) => (
            <text
              ref={(el: unknown) => {
                tickNodes[i] = el as PaintNode;
              }}
              flexShrink={0}
              height={0}
            >
              {""}
            </text>
          ))}
        </box>
        <box
          ref={(el: unknown) => {
            cardNode = el as PaintNode;
          }}
          position="absolute"
          width={0}
          height={0}
          zIndex={901}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(e: MouseEvent) => {
            steal(e);
            rail.dismissCard();
          }}
          onMouseUp={(e: MouseEvent) => steal(e)}
          onMouseMove={(e: MouseEvent) => steal(e)}
          onMouseOver={(e: MouseEvent) => steal(e)}
          onMouseOut={(e: MouseEvent) => steal(e)}
          onMouseScroll={(e: MouseEvent) => steal(e)}
        >
          <text
            ref={(el: unknown) => {
              cardHeaderNode = el as PaintNode;
            }}
            flexShrink={0}
          />
          {Array.from({ length: CARD_LINE_CAP }, (_, i) => (
            <text
              ref={(el: unknown) => {
                cardLineNodes[i] = el as PaintNode;
              }}
              flexShrink={0}
            />
          ))}
        </box>
      </box>
    ),
  });

  // ---- debug channel (off by default; the pty harness reads this) --------
  // Also honour an env var so the harness can enable it without needing the
  // object-form plugin entry (options) to survive config normalisation.
  const debugFile =
    typeof context.options.debugFile === "string"
      ? context.options.debugFile
      : (process.env.MESSAGE_RAIL_RAILDBG || "");
  const renderTimer = setInterval(() => {
    if (!paintRail()) return;
    try {
      context.renderer.requestRender();
    } catch {
      /* ignore */
    }
  }, 150);
  let dumper: ReturnType<typeof setInterval> | undefined;
  if (debugFile) {
    dumper = setInterval(() => {
      try {
        writeFileSync(debugFile, JSON.stringify(rail.debug(), null, 2));
      } catch {
        /* best effort — a bad debug path must not break the plugin */
      }
    }, 250);
  }

  return () => {
    clearInterval(renderTimer);
    if (dumper !== undefined) clearInterval(dumper);
    try {
      disposeApp();
    } catch {
      /* ignore */
    }
    try {
      disposeSidebar();
    } catch {
      /* ignore */
    }
    try {
      rail.dispose();
    } catch {
      /* ignore */
    }
    try {
      disposeRoot();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Invisible host component. `keymap.layer` is documented as "owned by the calling component",
 * so the layer must be registered from inside the slot's render owner, exactly like the
 * reference plugin's Keybinds component (dist/tui.js:760-786).
 */
function RailKeymap(props: { ctl: RailController; onToggle: () => void }) {
  const jumpBy = (delta: number) => {
    const v = props.ctl.view();
    if (!v.turns.length) return;
    const base = v.nav.activeIdx >= 0 ? v.nav.activeIdx : 0;
    const target = Math.max(0, Math.min(v.turns.length - 1, base + delta));
    const t = v.turns[target];
    if (t) props.ctl.jumpTo(t);
  };

  props.ctl.ctx.keymap.layer(() => ({
    mode: "global",
    priority: 8,
    commands: [
      {
        id: "message-rail.toggle",
        title: "Toggle message rail",
        description: "Show or hide the right-edge message anchor rail",
        group: "Message Rail",
        bind: "alt+r",
        palette: true,
        slash: { name: "rail" },
        run: () => {
          props.onToggle();
        },
      },
      {
        id: "message-rail.prev",
        title: "Message rail: previous turn",
        group: "Message Rail",
        bind: "alt+[",
        run: () => jumpBy(-1),
      },
      {
        id: "message-rail.next",
        title: "Message rail: next turn",
        group: "Message Rail",
        bind: "alt+]",
        run: () => jumpBy(1),
      },
    ],
    bindings: ["message-rail.toggle", "message-rail.prev", "message-rail.next"],
  }));

  return null;
}
