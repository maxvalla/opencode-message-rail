/**
 * Turn list construction — docs/design.md §G.5 (declared signatures), §D.7 notes.
 *
 * Two sources, one ordered list of navigable *user* turns:
 *   - the host cache (`context.data.session.message.list`), which is what host
 *     navigation itself walks, and
 *   - the server history (`context.client.message.list`), paginated to the
 *     cursor head, which is what a fresh session cannot answer from cache.
 *
 * Every export here is throw-free by contract (§B.6): a host read that fails
 * yields `[]` / `null`, never a propagating error into the reactive tree.
 */

import type { Context } from "@opencode-ai/plugin/tui/context";
import type { Turn } from "./geom";

export interface RawMsg {
  id: string;
  type: string;
  text?: string;
  time?: { created: number };
}

/** Host-cache user messages, in HOST order (the order host navigation walks). */
export function hostUsers(ctx: Context, sid: string): RawMsg[] {
  try {
    const list = (ctx.data.session.message.list(sid) ?? []) as unknown as RawMsg[];
    return list.filter((m) => m.type === "user");
  } catch {
    return [];
  }
}

/** Mirrors the host's own navigable() gate: user turns with non-empty text only. */
export function isNavigable(m: RawMsg): boolean {
  return m.type === "user" && (m.text ?? "").trim().length > 0;
}

export function toTurn(m: RawMsg): Turn {
  return { id: m.id, created: m.time?.created ?? 0, text: (m.text ?? "").trim() };
}

export function revertPoint(ctx: Context, sid: string): string | null {
  try {
    return ctx.data.session.get(sid)?.revert?.messageID ?? null;
  } catch {
    return null;
  }
}

export function mergeTurns(server: Map<string, Turn>, host: RawMsg[], revert: string | null): Turn[] {
  const merged = new Map<string, Turn>(server);
  for (const m of host) {
    if (!isNavigable(m)) continue;
    merged.set(m.id, toTurn(m));
  }
  let out = [...merged.values()];
  // Message ids are monotonic; the host does the equivalent slice at the revert point.
  if (revert) out = out.filter((t) => t.id < revert);
  out.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export interface FetchState {
  /** Mutable on purpose: `fetchAll` may replace it wholesale on a complete walk. */
  pool: Map<string, Turn>;
}

/**
 * Paginated server history.
 * Server constraints (verified against the reference plugin's notes AND the server source):
 *   - limit <= 200
 *   - `cursor` must be sent ALONE; it already encodes order, and sending `order` too yields
 *     InvalidCursorError ("Cursor cannot be combined with order").
 * Freshness and page caps are double insurance so a cursor semantic change can never loop forever.
 */
export async function fetchAll(ctx: Context, sid: string, state: FetchState): Promise<boolean> {
  const collected = new Map<string, Turn>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  let complete = false;

  for (let page = 0; page < 40; page++) {
    let res: any;
    try {
      res = cursor
        ? await ctx.client.message.list({ sessionID: sid, limit: 200, cursor })
        : await ctx.client.message.list({ sessionID: sid, limit: 200, order: "desc" });
    } catch {
      break;
    }
    const data: RawMsg[] = (res?.data ?? []) as RawMsg[];
    let fresh = 0;
    for (const m of data) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      fresh++;
      if (isNavigable(m)) collected.set(m.id, toTurn(m));
    }
    const next: string | null = res?.cursor?.next ?? null;
    if (!next) {
      complete = true;
      break;
    }
    if (fresh === 0) break; // cursor is not advancing
    cursor = next;
  }

  // Authoritative replace only when we walked to the cursor head; a partial result merges so an
  // early failure can never truncate turns we already know about.
  if (complete) state.pool = collected;
  else for (const [k, v] of collected) if (!state.pool.has(k)) state.pool.set(k, v);
  return complete;
}
