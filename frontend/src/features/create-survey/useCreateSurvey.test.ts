import { createElement, type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSurveyForCurrentUser, useCreateSurveyMutation } from "./useCreateSurvey";
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

    await createSurveyForCurrentUser({ schema: { pages: [] }, title: "Test form" });

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

    await expect(createSurveyForCurrentUser({ schema: { pages: [] }, title: "Test form" })).rejects.toThrow(
      "Пользователь не авторизован",
    );
  });

  it("creates template drafts unpublished by default", async () => {
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: { id: "user-1" } } } as never);
    vi.mocked(createSurvey).mockResolvedValue({ id: "template-1" } as never);

    await createSurveyForCurrentUser({ schema: { pages: [] }, title: "Template", formType: "template" });

    expect(createSurvey).toHaveBeenCalledWith({
      title: "Template",
      formType: "template",
      formReason: "plan",
      schema: { pages: [] },
      authorId: "user-1",
      isPublic: false,
    });
  });

  it("forwards explicit publication state from the mutation hook", async () => {
    vi.mocked(apiClient.auth.getCurrentUser).mockResolvedValue({ data: { user: { id: "user-1" } } } as never);
    vi.mocked(createSurvey).mockResolvedValue({ id: "private-form-1" } as never);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useCreateSurveyMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        schema: { pages: [] },
        title: "Private form",
        isPublic: false,
      });
    });

    expect(createSurvey).toHaveBeenCalledWith({
      title: "Private form",
      formType: "anketa",
      formReason: "plan",
      schema: { pages: [] },
      authorId: "user-1",
      isPublic: false,
    });
  });
});
