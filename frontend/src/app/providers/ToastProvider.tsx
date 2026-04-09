import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastType = "success" | "error" | "warning";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lastToastShownAtRef = useRef<Map<string, number>>(new Map());
  const timeoutIdsRef = useRef<number[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "warning") => {
    const key = `${type}:${message}`;
    const now = Date.now();
    const previousShownAt = lastToastShownAtRef.current.get(key);

    if (previousShownAt && now - previousShownAt < 1000) {
      return;
    }

    lastToastShownAtRef.current.set(key, now);

    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);

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

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.message}
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
