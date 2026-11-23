import { useEffect, useRef } from "react";
import { lockBodyScroll } from "./lockBodyScroll";

const FOCUSABLE_SELECTOR = "button, a[href], input, select, textarea, details > summary:first-of-type, [tabindex]";
const HIDDEN_SELECTOR = '[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary:first-of-type)';

const dialogStack: HTMLElement[] = [];

function isVisible(control: HTMLElement, root: HTMLElement) {
  for (let element: HTMLElement | null = control; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (element === root) return true;
  }
  return false;
}

function getActiveDialog() {
  for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
    const element = dialogStack[index];
    if (element.isConnected && !element.closest("[inert]")) return element;
  }
}

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
    dialogStack.push(element);

    const getFocusable = () =>
      Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((control) =>
        control.tabIndex >= 0
        && !control.matches(":disabled")
        && !control.closest(HIDDEN_SELECTOR)
        && isVisible(control, element),
      );

    if (!element.contains(document.activeElement)) {
      const first = getFocusable()[0];
      (first ?? element).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const nativeDialog = active?.closest("dialog[open]");
      if (getActiveDialog() !== element || event.defaultPrevented || (nativeDialog && !nativeDialog.contains(element))) return;
      if (event.key === "Escape") {
        if (!disabledRef.current && onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = getFocusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || active === element || !element.contains(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last ?? element : first ?? element).focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      const ownedFocus = !active || active === document.body || element.contains(active);
      dialogStack.splice(dialogStack.indexOf(element), 1);
      unlock();
      if (ownedFocus && trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    };
  }, []);

  return containerRef;
}
