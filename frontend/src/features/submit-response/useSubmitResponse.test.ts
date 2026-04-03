import { createElement, type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { submitResponse, useSubmitResponseMutation } from "./useSubmitResponse";
import { createResponse } from "../../entities/response/api";

vi.mock("../../entities/response/api", () => ({
  createResponse: vi.fn(),
}));

describe("submitResponse", () => {
  it("passes form id and payload to api", async () => {
    vi.mocked(createResponse).mockResolvedValue({ id: "response-1" } as never);

    const payload = { q1: "yes" };
    await submitResponse("form-1", payload);

    expect(createResponse).toHaveBeenCalledWith("form-1", payload);
  });

  it("invalidates dependent queries after successful submit", async () => {
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
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["forms"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["form", "form-1"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["survey-form", "form-1"] });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ["form-responses", "form-1"] });
  });
});
