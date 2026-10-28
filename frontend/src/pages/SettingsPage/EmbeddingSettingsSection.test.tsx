import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { refreshAuthDependentQueries } from "../../app/providers/authCache";
import { EmbeddingSettingsSection } from "./EmbeddingSettingsSection";

const { getEmbeddingSettings, saveEmbeddingSettings, showToast } = vi.hoisted(() => ({
  getEmbeddingSettings: vi.fn(), saveEmbeddingSettings: vi.fn(), showToast: vi.fn(),
}));
vi.mock("../../entities/site-settings/api", () => ({
  EMBEDDING_QUERY_KEY: ["embedding-settings"], getEmbeddingSettings, saveEmbeddingSettings,
  normalizeEmbeddingOrigin: (value: string) => value,
}));
vi.mock("../../app/providers/ToastProvider", () => ({ useToast: () => ({ showToast }) }));

beforeEach(() => {
  vi.resetAllMocks();
  getEmbeddingSettings.mockResolvedValue({ allowed_origins: ["https://example.ru"], updated_at: "before" });
});

it.each([false, true])("embedding save discards old-user results only after an auth change: %s", async switchUser => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolve!: (value: unknown) => void;
  saveEmbeddingSettings.mockImplementation(() => new Promise(done => { resolve = done; }));
  const { unmount } = render(<QueryClientProvider client={queryClient}><EmbeddingSettingsSection /></QueryClientProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Удалить https://example.ru" }));
  await userEvent.click(screen.getByRole("button", { name: "Сохранить сайты" }));
  await waitFor(() => expect(saveEmbeddingSettings).toHaveBeenCalledWith([]));
  if (switchUser) {
    unmount();
    refreshAuthDependentQueries(queryClient);
  }
  const saved = { allowed_origins: [], updated_at: "after" };
  await act(async () => { resolve(saved); });
  if (switchUser) {
    expect(queryClient.getQueryData(["embedding-settings"])).toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(queryClient.getQueryData(["embedding-settings"])).toEqual(saved));
    expect(showToast).toHaveBeenCalledWith("Разрешённые сайты сохранены", "success");
  }
});
