import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon";

describe("Icon accessibility", () => {
  it("keeps decorative glyphs out of the containing action's accessible name", () => {
    render(<button><Icon name="delete" />Удалить</button>);
    const button = screen.getByRole("button", { name: "Удалить" });
    expect(button.querySelector("[data-icon=delete]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(button).not.toHaveTextContent("delete");
  });

  it("exposes an accessible label when the icon carries meaning on its own", () => {
    render(<Icon name="check_circle" label="Сохранено" />);
    expect(screen.getByRole("img", { name: "Сохранено" })).not.toHaveAttribute("aria-hidden");
  });
});
