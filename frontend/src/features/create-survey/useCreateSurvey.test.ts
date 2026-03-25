import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSurveyForCurrentUser } from "./useCreateSurvey";
import { apiClient } from "../../shared/api";
import { createSurvey } from "../../entities/survey/api/surveysApi";

vi.mock("../../shared/api", () => ({
  apiClient: {
    auth: {
      getCurrentUser: vi.fn(),
    },
  },
}));

vi.mock("../../entities/survey/api/surveysApi", () => ({
  createSurvey: vi.fn(),
}));

describe("createSurveyForCurrentUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates survey with current user id", async () => {
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: { id: "user-1" } } } as never);
    vi.mocked(createSurvey).mockResolvedValue({ id: "form-1" } as never);

    await createSurveyForCurrentUser({ pages: [] }, "Test form");

    expect(createSurvey).toHaveBeenCalledWith({
      title: "Test form",
      formType: "anketa",
      formReason: "plan",
      schema: { pages: [] },
      authorId: "user-1",
    });
  });

  it("throws when user is not authenticated", async () => {
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: null } } as never);

    await expect(createSurveyForCurrentUser({ pages: [] }, "Test form")).rejects.toThrow(
      "Пользователь не авторизован",
    );
  });
});
