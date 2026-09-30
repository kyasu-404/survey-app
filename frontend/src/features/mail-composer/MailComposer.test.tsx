import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MailComposer } from "./MailComposer";

const { prepareFormMail, previewFormMail, queueFormInvitations, queueFormReminders } = vi.hoisted(() => ({
  prepareFormMail: vi.fn(), previewFormMail: vi.fn(), queueFormInvitations: vi.fn(), queueFormReminders: vi.fn(),
}));
vi.mock("../../entities/mail/api", () => ({ prepareFormMail, previewFormMail, queueFormInvitations, queueFormReminders }));
vi.mock("../../pages/FormResponsesPage/MailDeliveryPanel", () => ({ MailDeliveryPanel: () => <p>Журнал доставки</p> }));
const recipients = [1, 2].map(n => ({ id: `org${n}`, name: `Школа ${n}`, email: `org${n}@test.ru`, organizationType: "school", canSend: true }));
const composition = { personal: true, smtpEnabled: true, template: { subject: "Форма", bodyText: "Заполните {Ссылка}" }, recipients };
function mount(kind: "invitation" | "reminder" = "invitation") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MailComposer formId="form" kind={kind} />
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); prepareFormMail.mockResolvedValue(composition);
  previewFormMail.mockImplementation(async (_form, _kind, draft) => ({ personal: true, recipientCount: draft.organizationIds.length,
    message: { organizationId: draft.organizationIds[0], name: "Школа 2", email: "org2@test.ru", subject: draft.template.subject, bodyText: "Готовое письмо с персональной ссылкой" } }));
  queueFormInvitations.mockResolvedValue({ batchId: "batch", queuedCount: 1 });
  queueFormReminders.mockResolvedValue({ batchId: "batch", queuedCount: 1 });
});
for (const kind of ["invitation", "reminder"] as const) {
  it(`selects recipients, edits and previews before confirming ${kind}`, async () => {
    const user = userEvent.setup(); mount(kind);
    await user.click(await screen.findByRole("checkbox", { name: /Школа 1/ }));
    await user.click(screen.getByRole("button", { name: "К тексту письма" }));
    await user.clear(screen.getByLabelText("Тема письма")); await user.type(screen.getByLabelText("Тема письма"), "Моя тема");
    await user.click(screen.getByRole("button", { name: "Проверить письмо" }));
    expect(await screen.findByText("Готовое письмо с персональной ссылкой")).toBeVisible();
    expect(queueFormInvitations).not.toHaveBeenCalled(); expect(queueFormReminders).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Отправить письма (1)" }));
    await waitFor(() => expect(kind === "invitation" ? queueFormInvitations : queueFormReminders).toHaveBeenCalledExactlyOnceWith("form", {
      organizationIds: ["org2"], template: { ...composition.template, subject: "Моя тема" }, personal: true,
    }));
    expect(await screen.findByText("Журнал доставки")).toBeVisible();
  });
}
it("filters, selects only found organizations and keeps the draft when navigating back", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("Выбрано: 2 из 2");
  await user.click(screen.getByRole("button", { name: "Снять выбор" }));
  expect(screen.getByRole("button", { name: "К тексту письма" })).toBeDisabled();
  await user.type(screen.getByLabelText("Поиск организации или email"), "org2@");
  await user.click(screen.getByRole("button", { name: "Выбрать найденные" }));
  expect(screen.getByText("Выбрано: 1 из 2")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "К тексту письма" }));
  await user.type(screen.getByLabelText("Тема письма"), " — дополнение");
  await user.click(screen.getByRole("button", { name: "Назад" }));
  await user.click(screen.getByRole("button", { name: "К тексту письма" }));
  expect(screen.getByLabelText("Тема письма")).toHaveValue("Форма — дополнение");
});
it("shows preview errors and never sends while preparation fails", async () => {
  previewFormMail.mockRejectedValue(new Error("Добавьте {Ссылка}")); mount();
  await userEvent.click(await screen.findByRole("button", { name: "К тексту письма" }));
  await userEvent.click(screen.getByRole("button", { name: "Проверить письмо" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Добавьте {Ссылка}");
  expect(screen.getByLabelText("Текст письма")).toHaveValue(composition.template.bodyText);
  expect(queueFormInvitations).not.toHaveBeenCalled();
});
it("excludes bad addresses and disallows sending when SMTP is off", async () => {
  prepareFormMail.mockResolvedValue({ ...composition, smtpEnabled: false, personal: false, recipients: [recipients[0], { ...recipients[1], canSend: false }] });
  mount();
  expect(await screen.findByRole("checkbox", { name: /Школа 2/ })).toBeDisabled();
  expect(screen.getByText(/В письме будет общая ссылка/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "К тексту письма" }));
  await userEvent.click(screen.getByRole("button", { name: "Проверить письмо" }));
  expect(await screen.findByRole("button", { name: "Отправить письма (1)" })).toBeDisabled();
});
