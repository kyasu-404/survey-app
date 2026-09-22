import { useEffect, useRef, useState } from "react";
import type { SurveyResponse } from "../../entities/response/types";

/** Highlight newly received records, without treating pagination/deletion as arrival. */
export function useNewResponseHighlights(formId: string | undefined, page: number, rows: SurveyResponse[] | undefined, count: number) {
  const previous = useRef<{ key: string; ids: Set<string>; newest: string; count: number }>();
  const [highlighted, setHighlighted] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  useEffect(() => {
    const key = `${formId}:${page}`;
    if (previous.current?.key !== key) {
      previous.current = undefined;
      timers.current.forEach(clearTimeout); timers.current.clear();
      setHighlighted(new Set());
    }
    if (!rows) return;
    const before = previous.current;
    const newest = rows.reduce((latest, row) => row.created_at > latest ? row.created_at : latest, before?.newest ?? "");
    previous.current = { key, ids: new Set(rows.map(row => row.id)), newest, count };
    if (!before || page !== 1 || count <= before.count) return;
    const added = rows.filter(row => !before.ids.has(row.id) && row.created_at >= before.newest).map(row => row.id);
    if (!added.length) return;
    setHighlighted(current => new Set([...current, ...added]));
    for (const id of added) {
      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => {
        timers.current.delete(id);
        setHighlighted(current => { const next = new Set(current); next.delete(id); return next; });
      }, 1000));
    }
  }, [formId, page, rows, count]);
  return highlighted;
}
