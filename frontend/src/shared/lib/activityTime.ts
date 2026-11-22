const activityDateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function formatActivityTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? activityDateTime.format(date) : "—";
}
