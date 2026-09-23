import { useLayoutEffect, useRef, type PropsWithChildren, type RefObject } from "react";
import { Presence } from "./Presence";

/** Keep anchored actions out of scroll containers, including native dialogs. */
export function ViewportMenu({ children, anchor, enabled = true }: PropsWithChildren<{
  anchor: RefObject<HTMLElement>;
  enabled?: boolean;
}>) {
  const layer = useRef<HTMLDivElement>(null);
  const open = enabled && Boolean(children);

  useLayoutEffect(() => {
    const menu = layer.current;
    const target = anchor.current;
    if (!open || !menu || !target) return;
    // The top layer also escapes the transform used to animate native dialogs.
    menu.showPopover?.();
    const position = () => {
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      menu.style.maxWidth = `${width - 16}px`;
      menu.style.maxHeight = `${height - 16}px`;
      const rect = target.getBoundingClientRect();
      const top = rect.bottom + menu.offsetHeight + 14 <= y + height
        ? rect.bottom + 6 : rect.top - menu.offsetHeight - 6;
      const left = rect.right - menu.offsetWidth >= x + 8 ? rect.right - menu.offsetWidth : rect.left;
      menu.style.left = `${Math.max(x + 8, Math.min(left, x + width - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(y + 8, Math.min(top, y + height - menu.offsetHeight - 8))}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(menu);
    observer?.observe(target);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [anchor, open]);

  return <Presence kind="menu">{children && (enabled
    ? <div ref={layer} className="viewport-menu" {...{ popover: "manual" }}>{children}</div>
    : children)}</Presence>;
}
