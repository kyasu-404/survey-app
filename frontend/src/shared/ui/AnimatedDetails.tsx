import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { prefersReducedMotion } from "./Presence";

/** Native summary keyboard behavior, with reversible height animation. */
export function AnimatedDetails({ summary, children, open, className }: {
  summary: ReactNode; children: ReactNode; open: boolean; className?: string;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation>();
  const bodyAnimation = useRef<Animation>();
  const target = useRef(open);
  useLayoutEffect(() => {
    animation.current?.cancel();
    bodyAnimation.current?.cancel();
    target.current = open;
    if (root.current) { root.current.open = open; root.current.style.overflow = ""; }
    if (body.current) body.current.inert = !open;
  }, [open]);
  useEffect(() => () => { animation.current?.cancel(); bodyAnimation.current?.cancel(); }, []);

  function toggle() {
    const element = root.current;
    const content = body.current;
    if (!element || !content) return;
    const from = element.getBoundingClientRect().height;
    const opacity = getComputedStyle(content).opacity;
    const wasOpen = element.open;
    animation.current?.cancel();
    bodyAnimation.current?.cancel();
    const next = !target.current;
    target.current = next;
    element.open = next;
    element.style.overflow = "";
    content.inert = !next;
    if (prefersReducedMotion() || typeof element.animate !== "function") return;
    const to = element.getBoundingClientRect().height;
    element.open = true;
    element.style.overflow = "hidden";
    bodyAnimation.current = content.animate([{ opacity: wasOpen ? opacity : 0 }, { opacity: next ? 1 : 0 }], { duration: 200, fill: "both" });
    const motion = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 200, easing: "cubic-bezier(.22,1,.36,1)" });
    animation.current = motion;
    motion.onfinish = () => {
      if (animation.current !== motion) return;
      element.open = next;
      element.style.overflow = "";
      bodyAnimation.current?.cancel();
      animation.current = undefined;
    };
  }
  return <details ref={root} className={`animated-details ${className ?? ""}`}>
    <summary onClick={event => { event.preventDefault(); toggle(); }}>{summary}</summary>
    <div ref={body} className="animated-details-body">{children}</div>
  </details>;
}
