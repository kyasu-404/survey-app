import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "warning";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  leaving?: boolean;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastToastShownAtRef = useRef<Map<string, number>>(new Map());
  const timeoutIdsRef = useRef<number[]>([]);
  const toastLayerRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, type: ToastType = "warning") => {
    const key = `${type}:${message}`;
    const now = Date.now();
    const previousShownAt = lastToastShownAtRef.current.get(key);

    if (previousShownAt && now - previousShownAt < 1000) {
      return;
    }

    for (const [oldKey, shownAt] of lastToastShownAtRef.current) {
      if (now - shownAt >= 1000) lastToastShownAtRef.current.delete(oldKey);
    }
    lastToastShownAtRef.current.set(key, now);

    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);

    const leaveId = window.setTimeout(() => {
      setToasts(prev => prev.map(toast => toast.id === id ? { ...toast, leaving: true } : toast));
      timeoutIdsRef.current = timeoutIdsRef.current.filter(item => item !== leaveId);
    }, 2820);
    timeoutIdsRef.current.push(leaveId);

    const timeoutId = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      timeoutIdsRef.current = timeoutIdsRef.current.filter((item) => item !== timeoutId);
    }, 3000);

    timeoutIdsRef.current.push(timeoutId);
  }, []);

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
  }, [toasts.length]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div ref={toastLayerRef} className="toast-container" {...{popover: "manual"}} aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast-slot" data-state={toast.leaving ? "leaving" : "entered"}>
            <div className="toast-clip"><div className={`toast toast-${toast.type}`}>{toast.message}</div></div>
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
