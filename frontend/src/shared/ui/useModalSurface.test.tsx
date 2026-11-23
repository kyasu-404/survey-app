import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useModalSurface } from "./useModalSurface";

function Modal({ children, open }: { children?: ReactNode; open?: boolean }) {
  const dialog = useModalSurface();
  return <dialog ref={dialog} open={open} tabIndex={-1}>{children}</dialog>;
}

afterEach(() => vi.restoreAllMocks());

it("starts from the dialog and wraps focus through the summary of closed details", () => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([new DOMRect()] as unknown as DOMRectList);
  render(<Modal>
    <button>Закрыть</button>
    <details><summary>Дополнительно</summary><button>Скрытое действие</button></details>
  </Modal>);

  const dialog = screen.getByRole("dialog");
  const close = screen.getByRole("button", { name: "Закрыть" });
  const details = screen.getByText("Дополнительно");
  dialog.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(details).toHaveFocus();
  fireEvent.keyDown(details, { key: "Tab" });
  expect(close).toHaveFocus();
});

it("keeps focus in an empty dialog", () => {
  render(<Modal />);
  const dialog = screen.getByRole("dialog");
  dialog.focus();
  expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
  expect(dialog).toHaveFocus();
});

it("does not open an already open dialog a second time", () => {
  const open = vi.spyOn(HTMLDialogElement.prototype, "showModal");
  render(<Modal open />);
  expect(open).not.toHaveBeenCalled();
});
