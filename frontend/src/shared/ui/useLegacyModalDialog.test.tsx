import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useLegacyModalDialog } from "./useLegacyModalDialog";

function LegacyDialog({ label, pending = false, onClose }: {
  label: string; pending?: boolean; onClose: () => void;
}) {
  const ref = useLegacyModalDialog({ onClose, disabled: pending });
  return <div ref={ref} tabIndex={-1} role="dialog" aria-label={label}>
    <button type="button">First {label}</button>
    <div style={{ display: "none" }}><button type="button">Hidden {label}</button></div>
    <button type="button">Last {label}</button>
  </div>;
}

it("keeps the focus loop inside a busy dialog and leaves Escape inactive", () => {
  const close = vi.fn();
  render(<LegacyDialog label="busy" pending onClose={close} />);
  const first = screen.getByRole("button", { name: "First busy" });
  const last = screen.getByRole("button", { name: "Last busy" });
  last.focus();
  fireEvent.keyDown(last, { key: "Tab" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});

it("closes only the active dialog when another legacy dialog is open", () => {
  const closeParent = vi.fn();
  const closeChild = vi.fn();
  render(<><LegacyDialog label="parent" onClose={closeParent} /><LegacyDialog label="child" onClose={closeChild} /></>);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(closeChild).toHaveBeenCalledOnce();
  expect(closeParent).not.toHaveBeenCalled();
});
