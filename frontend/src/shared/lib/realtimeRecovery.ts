/** Ignore brief reconnects, retain updates over HTTP during a longer outage. */
export function createRealtimeRecovery(refresh: () => void, notify: (message: string, type: "warning" | "success") => void) {
  let warning: ReturnType<typeof setTimeout> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let reported = false, disposed = false;
  const clear = () => { clearTimeout(warning); clearInterval(polling); warning = undefined; polling = undefined; };
  const lost = () => {
    if (disposed || warning || polling) return;
    warning = setTimeout(() => {
      warning = undefined;
      reported = true;
      notify("Связь для автообновления прервалась. Проверяем новые данные каждые 15 секунд.", "warning");
      refresh();
      polling = setInterval(refresh, 15_000);
    }, 5000);
  };
  const online = () => { if (!disposed) refresh(); };
  window.addEventListener("offline", lost);
  window.addEventListener("online", online);
  if (!navigator.onLine) lost();
  return {
    status(status: string) {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        clear(); refresh();
        if (reported) notify("Соединение восстановлено. Автообновление снова работает.", "success");
        reported = false;
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) lost();
    },
    dispose() {
      disposed = true; clear();
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", online);
    },
  };
}
