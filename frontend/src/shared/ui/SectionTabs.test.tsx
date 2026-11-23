import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SectionTabs } from "./SectionTabs";

it("keeps the selected tab focused when navigation is disabled", () => {
  const onChange = vi.fn();
  render(<SectionTabs id="share-dialog" label="Способ поделиться"
    tabs={[{ value: "link", label: "Ссылка" }, { value: "mail", label: "Рассылка" }]}
    value="mail" onChange={onChange} disabled />);

  const selected = screen.getByRole("tab", { name: "Рассылка", selected: true });
  selected.focus();
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  expect(selected).toHaveFocus();

  const link = screen.getByRole("tab", { name: "Ссылка" });
  expect(link).toBeDisabled();
  fireEvent.click(link);
  expect(onChange).not.toHaveBeenCalled();
});
