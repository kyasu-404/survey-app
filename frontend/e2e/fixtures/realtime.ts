import type { Page, WebSocketRoute } from "@playwright/test";

type Filter = { id: number; table: string; event: string; schema: string; filter?: string };
type Join = { topic: string; ref: string; join_ref: string; payload: { config: { postgres_changes: Filter[] } } };

/** Local Phoenix protocol peer; no messages or mutations reach the real backend. */
export async function mockRealtime(page: Page) {
  const channels = new Map<string, { socket: WebSocketRoute; message: Join; filters: Filter[]; arrayFormat: boolean }>();
  const waiting: Array<() => void> = [];
  let paused = false;
  await page.routeWebSocket("**/realtime/v1/websocket*", socket => {
    socket.onMessage(raw => {
      const parsed = JSON.parse(String(raw));
      const message = Array.isArray(parsed) ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] } : parsed;
      const reply = (response: unknown = {}) => socket.send(JSON.stringify(Array.isArray(parsed)
        ? [message.join_ref, message.ref, message.topic, "phx_reply", { status: "ok", response }]
        : { topic: message.topic, ref: message.ref, join_ref: message.join_ref, event: "phx_reply", payload: { status: "ok", response } }));
      if (message.event === "phx_join") {
        const join = () => {
          const filters = (message.payload.config.postgres_changes ?? []).map((filter: Filter, id: number) => ({ ...filter, id: id + 1 }));
          channels.set(message.topic, { socket, message, filters, arrayFormat: Array.isArray(parsed) });
          reply({ postgres_changes: filters });
        };
        if (paused) waiting.push(join); else join();
      } else {
        if (message.event === "phx_leave") channels.delete(message.topic);
        reply();
      }
    });
  });
  return {
    connected: (prefix: string) => [...channels.keys()].some(topic => topic.includes(prefix)),
    change(table: string, type: "INSERT" | "UPDATE" | "DELETE", record: Record<string, unknown>, oldRecord = {}) {
      for (const { socket, message, filters, arrayFormat } of channels.values()) {
        const ids = filters.filter(filter => filter.table === table && (filter.event === "*" || filter.event === type)).map(filter => filter.id);
        const payload = { ids, data: {
          schema: "public", table, type, commit_timestamp: new Date().toISOString(), columns: [], record, old_record: oldRecord, errors: null,
        } };
        if (ids.length) socket.send(JSON.stringify(arrayFormat ? [message.join_ref, null, message.topic, "postgres_changes", payload]
          : { topic: message.topic, event: "postgres_changes", ref: null, join_ref: message.join_ref, payload }));
      }
    },
    disconnect() {
      paused = true;
      for (const { socket, message, arrayFormat } of channels.values()) socket.send(JSON.stringify(arrayFormat
        ? [message.join_ref, null, message.topic, "phx_error", {}]
        : { topic: message.topic, event: "phx_error", payload: {}, ref: null, join_ref: message.join_ref }));
      channels.clear();
    },
    reconnect() { paused = false; waiting.splice(0).forEach(join => join()); },
  };
}
