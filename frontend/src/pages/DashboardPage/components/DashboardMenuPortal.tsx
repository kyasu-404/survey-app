import { Presence } from "../../../shared/ui/Presence";
import { useLayoutEffect, useRef, type PropsWithChildren, type RefObject } from "react";
import { createPortal } from "react-dom";

// Table menus live outside the horizontal scroll container so even the last row stays usable.
export function DashboardMenuPortal({ children, anchor, enabled, align = "right" }: PropsWithChildren<{
  anchor: RefObject<HTMLDivElement>;
  enabled: boolean;
  align?: "left" | "right";
}>) {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!enabled || !children) return;
    const position = () => {
      const menu = menuRef.current;
      const target = anchor.current;
      if (!menu || !target) return;
      const rect = target.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = align === "left" ? rect.left : rect.right - width;
      const top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 6 : rect.top - height - 6;
      menu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [align, anchor, enabled, children]);
  if (!enabled) return <Presence kind="menu">{children}</Presence>;
  return createPortal(
    <Presence kind="menu">{children && <div ref={menuRef} className="dashboard-floating-root dashboard-table-menu" onClick={(event) => event.stopPropagation()}>
      {children}
    </div>}</Presence>, document.body,
  );
}
