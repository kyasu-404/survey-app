import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PersonalLinksPanel } from "./PersonalLinksPanel";
import { refreshAuthDependentQueries } from "../../../app/providers/authCache";

const { getPersonalLinks, setPersonalLinks, onCompose, exportPersonalLinksXlsx, showToast } = vi.hoisted(() => ({
  getPersonalLinks: vi.fn(), setPersonalLinks: vi.fn(), onCompose: vi.fn(), exportPersonalLinksXlsx: vi.fn(), showToast: vi.fn(),
}));
vi.mock("../../../entities/personal-link/api", () => ({ getPersonalLinks, setPersonalLinks }));
vi.mock("../../../entities/personal-link/xlsx", () => ({ exportPersonalLinksXlsx }));
vi.mock("../../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../FormResponsesPage/MailDeliveryPanel", () => ({ MailDeliveryPanel: () => <p>Статусы отправки</p> }));
const enabled = { available: true, canManage: true, enabled: true, links: [{ id: "org", token: "token" }] };
function mount(isPublic = true, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(<QueryClientProvider client={queryClient}>
    <PersonalLinksPanel formId="form" title="Отчёт" isPublic={isPublic} onCompose={onCompose} />
  </QueryClientProvider>);
}
beforeEach(() => { vi.resetAllMocks(); getPersonalLinks.mockResolvedValue({ ...enabled, enabled: false, links: [] }); });
it("disables generation without an organization question", async () => {
  getPersonalLinks.mockResolvedValue({ ...enabled, enabled: false, available: false });
  mount();
  expect(await screen.findByText("Доступны, если в форме есть вопрос «Организация»." )).toBeVisible();
  expect(screen.getByRole("switch", { name: "Персональные ссылки" })).toBeDisabled();
  expect(setPersonalLinks).not.toHaveBeenCalled();
});
it("generates links, downloads current mappings and opens the separate composer", async () => {
  setPersonalLinks.mockResolvedValue(enabled);
  mount();
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(setPersonalLinks).toHaveBeenCalledWith("form", true);
  await userEvent.click(screen.getByRole("button", { name: "Скачать XLSX" }));
  await waitFor(() => expect(exportPersonalLinksXlsx).toHaveBeenCalledWith("form", "Отчёт", enabled.links));
  await userEvent.click(screen.getByRole("button", { name: "Подготовить рассылку" }));
  expect(onCompose).toHaveBeenCalledOnce();
});
it("restores enabled state and disallows mailing a closed form", async () => {
  getPersonalLinks.mockResolvedValue(enabled);
  mount(false);
  expect(await screen.findByRole("button", { name: "Скачать XLSX" })).toBeEnabled();
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Подготовить рассылку" })).toBeDisabled();
});
it("preserves disabled state after a failed generation and reports its cause", async () => {
  setPersonalLinks.mockRejectedValue(new Error("Ошибка сервера"));
  mount();
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await userEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("Ошибка сервера", "error"));
  expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});

it.each(["toggle", "download"])("discards a late %s result after switching users", async action => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getPersonalLinks.mockResolvedValue(enabled);
  let resolve!: (value: typeof enabled) => void;
  setPersonalLinks.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { unmount } = mount(true, queryClient);
  const button = action === "toggle" ? screen.getByRole("switch") : await screen.findByRole("button", { name: "Скачать XLSX" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(setPersonalLinks).toHaveBeenCalledOnce();
  unmount();
  refreshAuthDependentQueries(queryClient);
  await act(async () => { resolve(enabled); });
  expect(queryClient.getQueryData(["form-personal-links", "form"])).toBeUndefined();
  expect(exportPersonalLinksXlsx).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
});
