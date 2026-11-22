const activityDateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function formatActivityTime(value: string) {
  return activityDateTime.format(new Date(value));
}
