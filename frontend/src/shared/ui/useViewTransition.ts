import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./Presence";

export function useViewTransition() {
  const active = useRef<{ skipTransition(): void; finished: Promise<void> }>();
  const fallback = useRef<Animation>();
  const request = useRef(0);
  useEffect(() => () => {
    request.current++;
    active.current?.skipTransition();
    fallback.current?.cancel();
  }, []);
  return (update: () => void) => {
    const current = ++request.current;
    const element = document.querySelector(".dashboard-layout-transition");
    const opacity = element ? getComputedStyle(element).opacity : "1";
    active.current?.skipTransition();
    fallback.current?.cancel();
    if (prefersReducedMotion()) { update(); return; }
    const commit = () => { if (request.current === current) flushSync(update); };
    if (!document.startViewTransition) {
      if (!element?.animate) { update(); return; }
      const motion = element.animate([{ opacity }, { opacity: 0 }], { duration: 60, fill: "forwards" });
      fallback.current = motion;
      motion.onfinish = () => {
        commit();
        motion.cancel();
        if (request.current !== current) return;
        const nextElement = document.querySelector(".dashboard-layout-transition");
        const entering = nextElement?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out", fill: "both" });
        fallback.current = entering;
        if (entering) entering.onfinish = () => {
          entering.cancel();
          if (fallback.current === entering) fallback.current = undefined;
        };
      };
      return;
    }
    const transition = document.startViewTransition(commit);
    // Rapid toggles deliberately skip snapshots; ready rejects in that case.
    void transition.ready.catch(() => {});
    active.current = transition;
    document.documentElement.dataset.formsTransition = "true";
    void transition.finished.catch(() => {}).finally(() => {
      if (active.current === transition) {
        active.current = undefined;
        delete document.documentElement.dataset.formsTransition;
      }
    });
  };
}
