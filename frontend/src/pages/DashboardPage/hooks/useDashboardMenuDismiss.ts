import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { OpenMenuState } from "../types";

export function useDashboardMenuDismiss(openedMenu: OpenMenuState, setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>) {
  useEffect(() => {
    if (!openedMenu) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".dashboard-floating-root")) {
        return;
      }

      setOpenedMenu(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenu, setOpenedMenu]);
}
