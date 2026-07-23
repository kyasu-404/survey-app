import { useEffect, type Dispatch, type SetStateAction } from "react";

export function useTemplatesMenuDismiss(
  openedMenuTemplateId: string | null,
  setOpenedMenuTemplateId: Dispatch<SetStateAction<string | null>>,
) {
  useEffect(() => {
    if (!openedMenuTemplateId) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".templates-floating-root")) {
        return;
      }

      setOpenedMenuTemplateId(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenuTemplateId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenuTemplateId, setOpenedMenuTemplateId]);
}
