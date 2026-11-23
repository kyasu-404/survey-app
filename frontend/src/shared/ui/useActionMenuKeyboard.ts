import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

const itemSelector = '[role="menuitem"]:not(:disabled):not([aria-disabled="true"])';

export function useActionMenuKeyboard(open: boolean, onOpen: () => void, onClose: () => void) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastItem = useRef(false);
  useLayoutEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>(itemSelector);
    items?.[lastItem.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    lastItem.current = false;
  }, [open]);

  function triggerKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.stopPropagation();
    event.preventDefault();
    lastItem.current = event.key === "ArrowUp";
    onOpen();
  }

  function menuKeyDown(event: KeyboardEvent) {
    if (event.key === " " && event.target instanceof HTMLAnchorElement && event.target.matches('a[href][role="menuitem"]')) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && event.target.matches(itemSelector)) event.target.click();
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.stopPropagation();
      if (event.key === "Escape") event.preventDefault();
      trigger.current?.focus({ preventScroll: true });
      onClose();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>(itemSelector) ?? []);
    if (!items.length) return;
    event.stopPropagation();
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const last = items.length - 1;
    const previous = current > 0 ? current - 1 : last;
    const following = current < last ? current + 1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? last
      : event.key === "ArrowUp" ? previous : following;
    items[next].focus({ preventScroll: true });
  }
  return { trigger, menu, triggerKeyDown, menuKeyDown };
}
