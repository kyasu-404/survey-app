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
    active.current?.skipTransition();
    fallback.current?.cancel();
    if (prefersReducedMotion()) { update(); return; }
    const commit = () => { if (request.current === current) flushSync(update); };
    if (!document.startViewTransition) {
      const element = document.querySelector(".dashboard-layout-transition");
      if (!element?.animate) { update(); return; }
      const motion = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, fill: "forwards" });
      fallback.current = motion;
      motion.onfinish = () => { commit(); motion.cancel(); fallback.current = undefined; };
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
