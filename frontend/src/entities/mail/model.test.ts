import { describe, expect, it } from "vitest";
import { EMPTY_SMTP_SETTINGS, getMailProgress, validateSmtpSettings } from "./model";
import type { MailJob } from "./types";

describe("mail model", () => {
  it("validates all required SMTP connection fields", () => {
    expect(validateSmtpSettings(EMPTY_SMTP_SETTINGS, false)).toMatch(/SMTP-сервер/);
    expect(validateSmtpSettings({
      ...EMPTY_SMTP_SETTINGS,
      host: "smtp.example.ru",
      username: "mail@example.ru",
      password: "secret",
      fromEmail: "mail@example.ru",
    }, false)).toBeNull();
  });

  it("allows an empty password when a saved credential exists", () => {
    expect(validateSmtpSettings({
      ...EMPTY_SMTP_SETTINGS,
      host: "smtp.example.ru",
      username: "mail@example.ru",
      fromEmail: "mail@example.ru",
    }, true)).toBeNull();
  });

  it("summarizes live delivery states", () => {
    const jobs = ["queued", "sent", "sent", "failed"].map((status, index) => ({
      id: String(index),
      status,
    })) as MailJob[];
    expect(getMailProgress(jobs)).toEqual({ queued: 1, processing: 0, sent: 2, failed: 1 });
  });
});
