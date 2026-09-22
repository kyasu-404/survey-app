import { useLayoutEffect, useRef, type HTMLAttributes } from "react";

/** One moving highlight, measured from the actual buttons (also after resize). */
export function AnimatedTabs({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  const measure = () => {
    const list = root.current;
    const active = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    // Native dialogs and hidden panels have no layout until they are shown.
    if (!list || !active || !active.offsetWidth || !active.offsetHeight) return;
    list.style.setProperty("--tab-x", `${active.offsetLeft}px`);
    list.style.setProperty("--tab-y", `${active.offsetTop}px`);
    list.style.setProperty("--tab-width", `${active.offsetWidth}px`);
    list.style.setProperty("--tab-height", `${active.offsetHeight}px`);
    list.dataset.indicatorReady = "true";
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const list = root.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    list.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, []);
  return <div {...props} ref={root} role="tablist" className={`animated-tabs ${className}`}>{children}</div>;
}
