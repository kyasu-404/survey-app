import { lockBodyScroll } from "./lockBodyScroll";
import { useEffect, useRef } from "react";

export function useModalSurface() {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    const unlock = lockBodyScroll();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !element) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
      )).filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0 && !control.closest('[hidden], [inert], [aria-hidden="true"]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    element?.addEventListener("keydown", keepFocus);
    return () => {
      element?.removeEventListener("keydown", keepFocus);
      element?.close();
      unlock();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return dialog;
}
