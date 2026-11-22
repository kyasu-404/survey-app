import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimAnnouncementPrompt, listAnnouncementPrompts, type AnnouncementPrompt } from "../../entities/announcement/promptApi";
import { acknowledgeAnnouncement, markNotificationsRead } from "../../entities/notification/api";
import { AnnouncementSpotlight } from "./AnnouncementSpotlight";

const auth = vi.hoisted(() => ({ loading: false, user: { id: "a" }, profile: { id: "a", role: "user", is_disabled: false } }));
vi.mock("../../app/providers/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../entities/announcement/promptApi");
vi.mock("../../entities/notification/api");

const prompt = (id: string, display_mode: "banner" | "modal"): AnnouncementPrompt => ({
  id, display_mode, title: "Объявление " + id, message: "Описание", read_at: null, acknowledged_at: null,
  require_acknowledgement: true, action_url: null, action_label: null, expires_at: null, presented_at: null,
});

function display() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const component = () => <StrictMode><QueryClientProvider client={client}><AnnouncementSpotlight /></QueryClientProvider></StrictMode>;
  const view = render(component());
  return { ...view, refreshAuth: () => view.rerender(component()) };
}

describe("announcement spotlight", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.loading = false;
    auth.profile.id = auth.user.id = "a";
    vi.mocked(claimAnnouncementPrompt).mockResolvedValue(true);
  });

  it("claims once across Strict Mode, closes without acknowledgement and only offers one modal per entry", async () => {
    const first = prompt("first", "modal"), second = prompt("second", "modal"), banner = prompt("banner", "banner");
    const claimed = new Set<string>();
    vi.mocked(listAnnouncementPrompts).mockImplementation(async ids => [
      ...[first, second].filter(row => !claimed.has(row.id)).slice(0, 1),
      ...[banner].filter(row => !claimed.has(row.id)),
      ...[first, second, banner].filter(row => ids.includes(row.id) && claimed.has(row.id)).map(row => ({ ...row, presented_at: "now" })),
    ]);
    vi.mocked(claimAnnouncementPrompt).mockImplementation(async row => { claimed.add(row.id); return true; });
    display();
    const modal = await screen.findByRole("dialog", { name: first.title });
    await screen.findByRole("region", { name: banner.title });
    fireEvent.click(within(modal).getByRole("button", { name: "Закрыть объявление" }));
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalled());
    expect(acknowledgeAnnouncement).not.toHaveBeenCalled();
    await waitFor(() => expect(listAnnouncementPrompts).toHaveBeenCalledWith([banner.id], expect.any(AbortSignal)));
    expect(vi.mocked(claimAnnouncementPrompt).mock.calls.map(([row]) => row.id)).toEqual([first.id, banner.id]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not claim while restoring auth or after a concurrent tab has won", async () => {
    auth.loading = true;
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([prompt("lost", "modal")]);
    vi.mocked(claimAnnouncementPrompt).mockResolvedValue(false);
    const view = display();
    expect(listAnnouncementPrompts).not.toHaveBeenCalled();
    auth.loading = false;
    view.refreshAuth();
    await waitFor(() => expect(claimAnnouncementPrompt).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refreshes live content and removes a withdrawn banner", async () => {
    const banner = prompt("latest", "banner");
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([banner]);
    display();
    await screen.findByRole("region", { name: banner.title });
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([{ ...banner, message: "Исправление", presented_at: "now" }]);
    fireEvent(window, new Event("focus"));
    expect(await screen.findByText("Исправление")).toBeVisible();
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([]);
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(claimAnnouncementPrompt).toHaveBeenCalledTimes(1);
  });

  it("drops a late response for the previous signed-in account", async () => {
    let finish: (rows: AnnouncementPrompt[]) => void = () => undefined;
    vi.mocked(listAnnouncementPrompts).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = display();
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([]);
    auth.profile.id = auth.user.id = "b";
    view.refreshAuth();
    await act(async () => { finish([prompt("previous", "modal")]); });
    expect(claimAnnouncementPrompt).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("defers an entry announcement until an existing alert dialog closes", async () => {
    const modal = prompt("entry", "modal");
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([modal]);
    const blocker = document.createElement("div");
    blocker.setAttribute("role", "alertdialog");
    blocker.setAttribute("aria-modal", "true");
    document.body.append(blocker);
    try {
      display();
      await act(async () => {});
      expect(claimAnnouncementPrompt).not.toHaveBeenCalled();
      blocker.remove();
      expect(await screen.findByRole("dialog", { name: modal.title })).toBeVisible();
      expect(claimAnnouncementPrompt).toHaveBeenCalledTimes(1);
    } finally { blocker.remove(); }
  });

  it("rechecks the audience after another dialog opens during a successful claim", async () => {
    const modal = prompt("claimed", "modal");
    let finish!: (value: boolean) => void;
    vi.mocked(claimAnnouncementPrompt).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(listAnnouncementPrompts).mockImplementation(async ids =>
      [{ ...modal, presented_at: ids.includes(modal.id) ? "now" : null }]);
    display();
    await waitFor(() => expect(claimAnnouncementPrompt).toHaveBeenCalledTimes(1));
    const blocker = document.createElement("dialog");
    blocker.open = true;
    document.body.append(blocker);
    try {
      await act(async () => finish(true));
      expect(screen.queryByRole("dialog", { name: modal.title })).toBeNull();
      blocker.remove();
      expect(await screen.findByRole("dialog", { name: modal.title })).toBeVisible();
      expect(listAnnouncementPrompts).toHaveBeenCalledWith([modal.id], expect.any(AbortSignal));
      expect(claimAnnouncementPrompt).toHaveBeenCalledTimes(1);
    } finally { blocker.remove(); }
  });

  it("skips announcements with an invalid deadline and ignores modal publications after entry", async () => {
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([{ ...prompt("bad", "banner"), expires_at: "unknown" }]);
    display();
    await act(async () => {});
    vi.mocked(listAnnouncementPrompts).mockResolvedValue([prompt("mid-session", "modal")]);
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(claimAnnouncementPrompt).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("removes an open announcement exactly at its deadline between polls", async () => {
    vi.useFakeTimers();
    try {
      const banner = { ...prompt("temporary", "banner"), expires_at: new Date(Date.now() + 2000).toISOString() };
      vi.mocked(listAnnouncementPrompts).mockResolvedValue([banner]);
      const view = display();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByRole("region", { name: banner.title })).toBeVisible();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.queryByRole("region")).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
