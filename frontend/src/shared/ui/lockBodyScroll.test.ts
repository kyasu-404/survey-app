import { expect, it } from "vitest";
import { lockBodyScroll } from "./lockBodyScroll";

it("releases a scroll lock only once and leaves other locks intact", () => {
  const original = document.body.style.overflow;
  document.body.style.overflow = "auto";
  const first = lockBodyScroll();
  const second = lockBodyScroll();
  try {
    first();
    first();
    expect(document.body.style.overflow).toBe("hidden");
    second();
    second();
    expect(document.body.style.overflow).toBe("auto");
  } finally {
    document.body.style.overflow = original;
  }
});
