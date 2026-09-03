import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, supabaseClient } from "../../shared/api";
import {
  MAX_APP_LOGO_SIZE_BYTES,
  getAppBranding,
  resetAppLogo,
  uploadAppLogo,
  validateAppLogoFile,
} from "./api";

vi.mock("../../shared/api", () => ({
  apiClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  supabaseClient: {
    storage: { from: vi.fn() },
  },
}));

describe("application branding api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("accepts safe raster logos and rejects unsupported or oversized files", () => {
    expect(() => validateAppLogoFile(new File(["logo"], "logo.png", { type: "image/png" }))).not.toThrow();
    expect(() => validateAppLogoFile(new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })))
      .toThrow("JPG, PNG и WebP");
    expect(() => validateAppLogoFile(
      new File([new Uint8Array(MAX_APP_LOGO_SIZE_BYTES + 1)], "logo.webp", { type: "image/webp" }),
    )).toThrow("не больше 2 МБ");
  });

  it("loads the configured logo and adds an update cache key", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        sidebar_logo_path: "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.png",
        updated_at: "2026-08-13T12:00:00.000Z",
      },
      error: null,
    });
    const abortSignal = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ abortSignal }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(apiClient.from).mockReturnValue({ select } as never);
    vi.mocked(supabaseClient.storage.from).mockReturnValue({
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://storage.test/logo.png" } })),
    } as never);

    await expect(getAppBranding()).resolves.toEqual(expect.objectContaining({
      sidebarLogoPath: "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.png",
      sidebarLogoUrl: "https://storage.test/logo.png?v=2026-08-13T12%3A00%3A00.000Z",
    }));
  });

  it("uploads a new logo, switches the database path, and removes the previous object", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://storage.test/new-logo.png" } }));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");
    vi.mocked(supabaseClient.storage.from).mockReturnValue({ upload, remove, getPublicUrl } as never);
    vi.mocked(apiClient.rpc).mockResolvedValue({
      data: [{
        sidebar_logo_path: "app-branding/sidebar-logo-22222222-2222-4222-8222-222222222222.png",
        previous_sidebar_logo_path: "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.png",
        updated_at: "2026-08-13T12:00:00.000Z",
      }],
      error: null,
    } as never);

    await uploadAppLogo(new File(["logo"], "logo.png", { type: "image/png" }));

    expect(upload).toHaveBeenCalledWith(
      "app-branding/sidebar-logo-22222222-2222-4222-8222-222222222222.png",
      expect.any(File),
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
    expect(apiClient.rpc).toHaveBeenCalledWith("set_sidebar_logo_path", {
      p_sidebar_logo_path: "app-branding/sidebar-logo-22222222-2222-4222-8222-222222222222.png",
    });
    expect(remove).toHaveBeenCalledWith([
      "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.png",
    ]);
  });

  it("restores the built-in logo and deletes the former custom object", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(supabaseClient.storage.from).mockReturnValue({ remove } as never);
    vi.mocked(apiClient.rpc).mockResolvedValue({
      data: [{
        sidebar_logo_path: null,
        previous_sidebar_logo_path: "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.webp",
        updated_at: "2026-08-13T12:00:00.000Z",
      }],
      error: null,
    } as never);

    await expect(resetAppLogo()).resolves.toEqual(expect.objectContaining({ sidebarLogoUrl: null }));
    expect(apiClient.rpc).toHaveBeenCalledWith("set_sidebar_logo_path", { p_sidebar_logo_path: null });
    expect(remove).toHaveBeenCalledWith([
      "app-branding/sidebar-logo-11111111-1111-4111-8111-111111111111.webp",
    ]);
  });
});
