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
  // TODO(turns): read ctx.data.session.message.list(sid) and keep type === "user".
  throw new Error("TODO: hostUsers");
}

/** Mirrors the host's own navigable() gate: user turns with non-empty text only. */
export function isNavigable(m: RawMsg): boolean {
  // TODO(turns): user message with non-blank text.
  throw new Error("TODO: isNavigable");
}

export function toTurn(m: RawMsg): Turn {
  // TODO(turns): map RawMsg -> Turn (id, created, trimmed text).
  throw new Error("TODO: toTurn");
}

export function revertPoint(ctx: Context, sid: string): string | null {
  // TODO(turns): read session revert.messageID; null when absent.
  throw new Error("TODO: revertPoint");
}

export function mergeTurns(server: Map<string, Turn>, host: RawMsg[], revert: string | null): Turn[] {
  // TODO(turns): merge server pool + host cache, slice at the revert point, sort by created then id.
  throw new Error("TODO: mergeTurns");
}

export interface FetchState {
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
  // TODO(turns): page ctx.client.message.list (limit 200) following cursor.next, then replace/merge the pool.
  throw new Error("TODO: fetchAll");
}
