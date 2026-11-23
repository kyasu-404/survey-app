import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MessageEditor } from "./MessageEditor";

function renderEditor(message: string) {
  function Editor() {
    const [value, setValue] = useState(message);
    return <MessageEditor value={value} onChange={setValue} />;
  }

  render(<Editor />);
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Текст объявления" });
  return {
    input,
    async format(start: number, end: number, name: string, value: string, selection: string) {
      input.setSelectionRange(start, end);
      fireEvent.click(screen.getByRole("button", { name }));
      expect(input).toHaveValue(value);
      await waitFor(() => {
        expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(selection);
      });
    },
  };
}

it("keeps the content of a list item selected for repeated formatting", async () => {
  const { input, format } = renderEditor("  - Привет");
  await format(0, input.value.length, "Курсив", "  - *Привет*", "Привет");
  await format(input.selectionStart, input.selectionEnd, "Полужирный", "  - ***Привет***", "Привет");
});

it("treats a selected dash in the middle of a line as text", async () => {
  const { input, format } = renderEditor("Цена - 100");
  await format(5, input.value.length, "Полужирный", "Цена **- 100**", "- 100");
});

it("keeps complete markup selected across several list items", async () => {
  const { input, format } = renderEditor("- Первое\r\n  * Второе");
  const italic = "- *Первое*\n  * *Второе*";
  const emphasized = "- ***Первое***\n  * ***Второе***";
  await format(0, input.value.length, "Курсив", italic, italic);
  await format(input.selectionStart, input.selectionEnd, "Полужирный", emphasized, emphasized);
});

it("removes bold when the selection includes both delimiters", async () => {
  const { input, format } = renderEditor("**Текст**");
  await format(0, input.value.length, "Полужирный", "Текст", "Текст");
});

it("toggles one emphasis style while keeping the other and preserving the selection", async () => {
  const { input, format } = renderEditor("- Привет");
  await format(2, input.value.length, "Курсив", "- *Привет*", "Привет");
  await format(input.selectionStart, input.selectionEnd, "Полужирный", "- ***Привет***", "Привет");
  await format(input.selectionStart, input.selectionEnd, "Курсив", "- **Привет**", "Привет");
  await format(input.selectionStart, input.selectionEnd, "Полужирный", "- Привет", "Привет");
});

it("associates each editor with its own label", () => {
  render(<><MessageEditor value="Первое" onChange={vi.fn()} /><MessageEditor value="Второе" onChange={vi.fn()} /></>);
  expect(screen.getAllByRole("textbox", { name: "Текст объявления" })).toHaveLength(2);
});
