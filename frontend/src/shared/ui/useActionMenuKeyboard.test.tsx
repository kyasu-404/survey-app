import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useActionMenuKeyboard } from "./useActionMenuKeyboard";

function Menu({ middleDisabled = false }: { middleDisabled?: boolean }) {
  const keyboard = useActionMenuKeyboard(true, vi.fn(), vi.fn());
  return <div ref={keyboard.menu} role="menu" tabIndex={-1} onKeyDown={keyboard.menuKeyDown}>
    <button role="menuitem" type="button">Первый</button>
    <button role="menuitem" type="button" aria-disabled={middleDisabled || undefined}>Второй</button>
    <button role="menuitem" type="button">Третий</button>
  </div>;
}

it("moves from the menu container to the last or first action according to the arrow", () => {
  render(<Menu />);
  const menu = screen.getByRole("menu");
  menu.focus();
  fireEvent.keyDown(menu, { key: "ArrowUp" });
  expect(screen.getByRole("menuitem", { name: "Третий" })).toHaveFocus();

  menu.focus();
  fireEvent.keyDown(menu, { key: "ArrowDown" });
  expect(screen.getByRole("menuitem", { name: "Первый" })).toHaveFocus();
});

it("moves to the last action when the focused one becomes unavailable", () => {
  const { rerender } = render(<Menu />);
  const middle = screen.getByRole("menuitem", { name: "Второй" });
  middle.focus();
  rerender(<Menu middleDisabled />);
  fireEvent.keyDown(middle, { key: "ArrowUp" });
  expect(screen.getByRole("menuitem", { name: "Третий" })).toHaveFocus();
});
