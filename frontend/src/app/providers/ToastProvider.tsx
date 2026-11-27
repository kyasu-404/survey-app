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
  expiresAt: number;
  action?: ToastAction;
  actionPending?: boolean;
  leaving?: boolean;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastToastShownAtRef = useRef<Map<string, number>>(new Map());
  const timeoutIdsRef = useRef<number[]>([]);
  const pendingActionsRef = useRef(new Set<number>());
  const nextId = useRef(0);
  const actionFocus = useRef<{ id: number; from: HTMLElement; button?: HTMLButtonElement }>();
  const toastLayerRef = useRef<HTMLDivElement>(null);

  const restoreActionFocus = useCallback((id: number) => {
    const focus = actionFocus.current;
    if (focus?.id !== id) return;
    actionFocus.current = undefined;
    if (document.activeElement === focus.button && focus.from.isConnected) focus.from.focus({ preventScroll: true });
  }, []);

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
    if (action?.focusFrom) actionFocus.current = { id, from: action.focusFrom };
    setToasts((prev) => [...prev, { id, message, type, action, expiresAt: now + durationMs }]);

    const leaveId = window.setTimeout(() => {
      restoreActionFocus(id);
      setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, leaving: true } : toast));
      timeoutIdsRef.current = timeoutIdsRef.current.filter(item => item !== leaveId);
    }, durationMs - (action ? 0 : 180));
    timeoutIdsRef.current.push(leaveId);

    const timeoutId = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      timeoutIdsRef.current = timeoutIdsRef.current.filter((item) => item !== timeoutId);
    }, durationMs + (action ? 180 : 0));

    timeoutIdsRef.current.push(timeoutId);
  }, [restoreActionFocus]);

  async function runAction({ id, action, expiresAt }: Toast) {
    if (!action || Date.now() >= expiresAt || pendingActionsRef.current.has(id)) return;
    pendingActionsRef.current.add(id);
    setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, actionPending: true } : toast));
    try {
      if (await action.run()) {
        restoreActionFocus(id);
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }
    } finally {
      pendingActionsRef.current.delete(id);
      setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, actionPending: false } : toast));
    }
  }

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutIdsRef.current = [];
    };
  }, []);

  useEffect(() => {
    const layer = toastLayerRef.current;
    if (typeof layer?.showPopover === "function") {
      if (toasts.length && !layer.matches(":popover-open")) layer.showPopover();
      else if (!toasts.length && layer.matches(":popover-open")) layer.hidePopover();
    }
    const focus = actionFocus.current;
    if (focus && !focus.button) {
      const button = layer?.querySelector<HTMLButtonElement>(`[data-toast-action="${focus.id}"]`);
      if (button && document.activeElement === focus.from) {
        focus.button = button;
        button.focus({ preventScroll: true });
      }
    }
  }, [toasts.length]);

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
