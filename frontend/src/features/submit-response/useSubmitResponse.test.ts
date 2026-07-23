import { createElement, type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { submitResponse, useSubmitResponseMutation } from "./useSubmitResponse";
import { createResponse } from "../../entities/response/api";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";

vi.mock("../../entities/response/api", () => ({
  createResponse: vi.fn(),
}));

describe("submitResponse", () => {
  it("passes form id and payload to api", async () => {
    vi.mocked(createResponse).mockResolvedValue({ id: "response-1" } as never);

    const payload = { q1: "yes" };
    await submitResponse("form-1", payload, "123e4567-e89b-42d3-a456-426614174000");

    expect(createResponse).toHaveBeenCalledWith("form-1", payload, "123e4567-e89b-42d3-a456-426614174000");
  });

  it("invalidates dependent admin queries without refetching the active public survey after successful submit", async () => {
    vi.mocked(createResponse).mockResolvedValue({ id: "response-2" } as never);

    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSubmitResponseMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        formId: "form-1",
        data: { q1: "answer" },
        submissionId: "123e4567-e89b-42d3-a456-426614174001",
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({ queryKey: DASHBOARD_FORMS_QUERY_ROOT });
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({ queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["form", "form-1"] });
    expect(invalidateQueriesSpy).not.toHaveBeenCalledWith({ queryKey: ["survey-form", "form-1"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["form-responses", "form-1"] });
  });
});
