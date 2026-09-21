import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Retain the last rendered content during exit, without retaining interaction. */
export function Presence({ children, kind = "modal" }: { children: ReactNode; kind?: "modal" | "menu" | "drawer" }) {
  const present = Boolean(children);
  const [retained, setRetained] = useState(children);
  const root = useRef<HTMLDivElement>(null);
  const duration = kind === "menu" ? 120 : kind === "drawer" ? 240 : 180;
  if (present && retained !== children) setRetained(children);

  useEffect(() => {
    if (present) return;
    const timer = window.setTimeout(() => setRetained(null), prefersReducedMotion() ? 0 : duration);
    return () => window.clearTimeout(timer);
  }, [present, duration]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Modal dialogs in the top layer escape an ancestor's inertness.
    element.inert = !present;
    element.querySelectorAll("dialog").forEach(dialog => { dialog.inert = !present; });
    if (!present && element.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
  });

  if (!present && (!retained || prefersReducedMotion())) return null;
  return <div ref={root} className={`motion-presence motion-${kind}`} data-state={present ? "entered" : "leaving"} aria-hidden={!present || undefined}>
    {present ? children : retained}
  </div>;
}
