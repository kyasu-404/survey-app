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

it("activates a menu link on Space without scrolling", () => {
  const onClick = vi.fn((event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault());
  function LinkMenu() {
    const keyboard = useActionMenuKeyboard(true, vi.fn(), vi.fn());
    return <div ref={keyboard.menu} role="menu" onKeyDown={keyboard.menuKeyDown}>
      <a role="menuitem" href="/automations" onClick={onClick}>Автоматизации</a>
    </div>;
  }

  render(<LinkMenu />);
  const link = screen.getByRole("menuitem", { name: "Автоматизации" });
  expect(link).toHaveFocus();
  expect(fireEvent.keyDown(link, { key: " " })).toBe(false);
  expect(onClick).toHaveBeenCalledOnce();
});

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
