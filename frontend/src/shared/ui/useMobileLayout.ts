import { useSyncExternalStore } from "react";

// Keep this breakpoint in sync with responsive.css and useSidebarMotion.
export const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(MOBILE_LAYOUT_QUERY);
  if (!media) return () => {};
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useMobileLayout() {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(MOBILE_LAYOUT_QUERY).matches ?? false, () => false);
}
