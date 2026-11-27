import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "warning";

type ToastAction = {
  label: string;
  // Return false to keep the action available until the toast expires.
  run: () => Promise<boolean>;
  focusFrom?: HTMLElement;
};

type ToastOptions = {
  action?: ToastAction;
  durationMs?: number;
};

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
  actionPending?: boolean;
  leaving?: boolean;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
};

type ToastTimer = { timeoutId: number; expiresAt?: number };
type ToastActionFocus = { from: HTMLElement; button?: HTMLButtonElement };
const LEAVE_DURATION_MS = 180;

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastToastShownAtRef = useRef<Map<string, number>>(new Map());
  const timers = useRef(new Map<number, ToastTimer>());
  const pendingActionsRef = useRef(new Set<number>());
  const nextId = useRef(0);
  const actionFocus = useRef(new Map<number, ToastActionFocus>());
  const toastLayerRef = useRef<HTMLDivElement>(null);

  const restoreActionFocus = useCallback((id: number) => {
    const focus = actionFocus.current.get(id);
    if (!focus) return;
    actionFocus.current.delete(id);
    if (document.activeElement === focus.button && focus.from.isConnected) focus.from.focus({ preventScroll: true });
  }, []);

  const scheduleExpiration = useCallback((id: number, durationMs: number, hasAction: boolean) => {
    const leaveDuration = hasAction ? LEAVE_DURATION_MS : Math.min(LEAVE_DURATION_MS, durationMs);
    const leaveAfter = hasAction ? durationMs : durationMs - leaveDuration;
    const timeoutId = window.setTimeout(() => {
      // Close the action window before the leaving state commits to the DOM.
      const removalId = window.setTimeout(() => {
        timers.current.delete(id);
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, leaveDuration);
      timers.current.set(id, { timeoutId: removalId });
      restoreActionFocus(id);
      setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, leaving: true } : toast));
    }, leaveAfter);
    timers.current.set(id, { timeoutId, expiresAt: performance.now() + durationMs });
  }, [restoreActionFocus]);

  const showToast = useCallback((message: string, type: ToastType = "warning", { action, durationMs = 3000 }: ToastOptions = {}) => {
    const now = Date.now();
    if (!action) {
      const key = `${type}:${message}`;
      const previousShownAt = lastToastShownAtRef.current.get(key);

      if (previousShownAt !== undefined && now - previousShownAt < 1000) return;

      for (const [oldKey, shownAt] of lastToastShownAtRef.current) {
        if (now - shownAt >= 1000) lastToastShownAtRef.current.delete(oldKey);
      }
      lastToastShownAtRef.current.set(key, now);
    }

    const id = ++nextId.current;
    if (action?.focusFrom) actionFocus.current.set(id, { from: action.focusFrom });
    setToasts(prev => [...prev, { id, message, type, action }]);
    scheduleExpiration(id, durationMs, Boolean(action));
  }, [scheduleExpiration]);

  async function runAction({ id, action, actionPending, leaving }: Toast) {
    const timer = timers.current.get(id);
    if (!action || actionPending || leaving || timer?.expiresAt === undefined) return;
    const remaining = timer.expiresAt - performance.now();
    if (remaining <= 0) return;

    window.clearTimeout(timer.timeoutId);
    timers.current.delete(id);
    pendingActionsRef.current.add(id);
    setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, actionPending: true } : toast));

    let completed = false;
    try {
      completed = await action.run();
    } finally {
      if (pendingActionsRef.current.delete(id)) {
        if (completed) {
          restoreActionFocus(id);
          setToasts(prev => prev.filter(toast => toast.id !== id));
        } else {
          setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, actionPending: false } : toast));
          scheduleExpiration(id, remaining, true);
        }
      }
    }
  }

  useEffect(() => {
    const activeTimers = timers.current;
    const activeActions = pendingActionsRef.current;
    const focusTargets = actionFocus.current;
    return () => {
      activeTimers.forEach(timer => window.clearTimeout(timer.timeoutId));
      activeTimers.clear();
      activeActions.clear();
      focusTargets.clear();
    };
  }, []);

  useEffect(() => {
    const layer = toastLayerRef.current;
    if (typeof layer?.showPopover === "function") {
      if (toasts.length && !layer.matches(":popover-open")) layer.showPopover();
      else if (!toasts.length && layer.matches(":popover-open")) layer.hidePopover();
    }
    for (const [id, focus] of [...actionFocus.current].reverse()) {
      if (focus.button || document.activeElement !== focus.from) continue;
      const button = layer?.querySelector<HTMLButtonElement>(`[data-toast-action="${id}"]`);
      if (button) {
        focus.button = button;
        button.focus({ preventScroll: true });
        break;
      }
    }
  }, [toasts]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div ref={toastLayerRef} className="toast-container" {...{popover: "manual"}} aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast-slot" data-state={toast.leaving ? "leaving" : "entered"}>
            <div className="toast-clip"><div className={`toast toast-${toast.type}`}>
              <span>{toast.message}</span>
              {toast.action && <button type="button" className="toast-action" data-toast-action={toast.id}
                aria-disabled={toast.actionPending || toast.leaving}
                onClick={() => void runAction(toast)}>{toast.action.label}</button>}
            </div></div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast должен использоваться внутри ToastProvider");
  }

  return context;
}
