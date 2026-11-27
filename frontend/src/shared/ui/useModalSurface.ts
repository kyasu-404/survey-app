import { lockBodyScroll } from "./lockBodyScroll";
import { useEffect, useRef, type RefObject } from "react";

const controlsSelector = "button, a[href], input, select, textarea, details > summary:first-of-type, [tabindex]";
const hiddenSelector = '[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary:first-of-type)';

export function useModalSurface(initialFocus?: RefObject<HTMLElement>) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!element.open) element.showModal();
    initialFocus?.current?.focus({ preventScroll: true });
    const unlock = lockBodyScroll();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = Array.from(element.querySelectorAll<HTMLElement>(controlsSelector)).filter(control =>
        control.tabIndex >= 0 && !control.matches(":disabled") && !control.closest(hiddenSelector)
        && control.getClientRects().length > 0 && getComputedStyle(control).visibility === "visible",
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!first || active === element || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        const target = event.shiftKey ? last : first;
        (target ?? element).focus();
      }
    };
    element.addEventListener("keydown", keepFocus);
    return () => {
      element.removeEventListener("keydown", keepFocus);
      if (element.open) element.close();
      unlock();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [initialFocus]);
  return dialog;
}
