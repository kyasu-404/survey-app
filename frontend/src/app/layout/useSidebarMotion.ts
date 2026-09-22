import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "../../shared/ui/Presence";

/** Reflow the long forms list once, then slide it using a compositor transform. */
export function useSidebarMotion(pathname: string) {
  const motion = useRef<Animation>();
  const finish = () => { motion.current?.cancel(); motion.current = undefined; };
  useEffect(() => {
    window.addEventListener("resize", finish);
    return () => { window.removeEventListener("resize", finish); finish(); };
  }, [pathname]);

  const change = (update: () => void) => {
    const content = document.querySelector<HTMLElement>(".dashboard-page");
    if (!content || !window.matchMedia("(min-width: 761px)").matches || prefersReducedMotion() || !content.animate) {
      finish(); update(); return;
    }
    const before = content.getBoundingClientRect().left;
    finish();
    flushSync(update);
    const offset = before - content.getBoundingClientRect().left;
    const animation = content.animate([{ transform: `translateX(${offset}px)` }, { transform: "none" }], {
      duration: 300, easing: "cubic-bezier(.22,1,.36,1)",
    });
    motion.current = animation;
    animation.onfinish = () => { if (motion.current === animation) finish(); };
  };
  return { change, finish };
}
