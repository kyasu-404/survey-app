import { useEffect, useRef } from "react";
import { lockBodyScroll } from "./lockBodyScroll";

const FOCUSABLE_SELECTOR = "button, a[href], input, select, textarea, details > summary:first-of-type, [tabindex]";
const HIDDEN_SELECTOR = '[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary:first-of-type)';

export function useLegacyModalDialog<T extends HTMLElement = HTMLDivElement>(
  options: { onClose?: () => void; disabled?: boolean } = {},
) {
  const containerRef = useRef<T>(null);
  const onCloseRef = useRef(options.onClose);
  const disabledRef = useRef(Boolean(options.disabled));
  onCloseRef.current = options.onClose;
  disabledRef.current = Boolean(options.disabled);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockBodyScroll();

    const getFocusable = () =>
      Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((control) =>
        control.tabIndex >= 0
        && !control.matches(":disabled")
        && !control.closest(HIDDEN_SELECTOR)
        && getComputedStyle(control).visibility !== "hidden",
      );

    if (!element.contains(document.activeElement)) {
      const first = getFocusable()[0];
      (first ?? element).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!disabledRef.current && onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (disabledRef.current) return;
      if (event.key !== "Tab" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = getFocusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      if (!first || active === element || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last ?? element : first ?? element).focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlock();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return containerRef;
}
