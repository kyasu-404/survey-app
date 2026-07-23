import { describe, expect, it } from "vitest";
import { scrubTelemetryEventForTransport, scrubTelemetryUrl } from "./observability";

describe("observability transport scrubbing", () => {
  it("removes query strings, fragments, and URL credentials", () => {
    expect(scrubTelemetryUrl("https://user:pass@survey.test/auth?code=secret#access_token=jwt")).toBe(
      "https://survey.test/auth",
    );
    expect(scrubTelemetryUrl("/auth/callback?code=secret#refresh_token=secret")).toBe("/auth/callback");
  });

  it("redacts auth callback secrets from Sentry events and transaction spans", () => {
    const event = {
      transaction: "https://survey.test/auth?code=secret#access_token=jwt",
      request: {
        url: "https://survey.test/auth?code=secret#refresh_token=secret",
        query_string: "code=secret",
        headers: { authorization: "Bearer secret" },
      },
      spans: [{ data: { url: "https://survey.test/auth#access_token=jwt" } }],
    };

    expect(scrubTelemetryEventForTransport(event)).toEqual({
      transaction: "https://survey.test/auth",
      request: {
        url: "https://survey.test/auth",
        query_string: "[redacted]",
        headers: { authorization: "[redacted]" },
      },
      spans: [{ data: { url: "https://survey.test/auth" } }],
    });
  });
});
