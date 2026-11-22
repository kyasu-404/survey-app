export type TimelineCursor = { created_at: string; id: string };

export const TIMELINE_PAGE_SIZE = 25;

export function timelineBefore(cursor: TimelineCursor) {
  return "created_at.lt." + cursor.created_at + ",and(created_at.eq." + cursor.created_at + ",id.lt." + cursor.id + ")";
}

export function timelinePage<T extends TimelineCursor>(rows: T[]) {
  const items = rows.slice(0, TIMELINE_PAGE_SIZE);
  const last = items[items.length - 1];
  return {
    items,
    next: rows.length > TIMELINE_PAGE_SIZE && last ? { created_at: last.created_at, id: last.id } : undefined,
  };
}
