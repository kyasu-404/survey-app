import { describe, expect, it } from "vitest";
import { RequestTimeoutError } from "../api/request";
import { getAuthErrorMessage, getErrorMessage, getSubmitResponseErrorMessage, isAbortError } from "./error";

describe("error helpers", () => {
  it("prefers a concrete Error message over the fallback", () => {
    expect(getErrorMessage(new Error("Точное сообщение"), "Запасной текст")).toBe("Точное сообщение");
    expect(getErrorMessage({ message: "ignored" }, "Запасной текст")).toBe("Запасной текст");
  });

  it("maps common auth API failures to user-facing Russian messages", () => {
    expect(getAuthErrorMessage(new Error("Invalid login credentials"))).toBe("Неверная почта или пароль.");
    expect(getAuthErrorMessage({ code: "invalid_credentials", status: 400 })).toBe("Неверная почта или пароль.");
    expect(getAuthErrorMessage({ code: "user_banned", message: "User is banned", status: 400 })).toBe(
      "Учётная запись отключена. Обратитесь к администратору.",
    );
    expect(getAuthErrorMessage(new Error("Email not confirmed"))).toBe(
      "Подтвердите адрес электронной почты перед входом.",
    );
    expect(getAuthErrorMessage(new Error("Network request failed"))).toBe(
      "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.",
    );
    expect(getAuthErrorMessage(new TypeError("Load failed"))).toBe(
      "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.",
    );
    expect(getAuthErrorMessage(Object.assign(new Error("{}"), { name: "AuthRetryableFetchError", status: 0 }))).toBe(
      "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.",
    );
    expect(getAuthErrorMessage(new Error("Too many requests"))).toBe(
      "Слишком много попыток входа. Подождите немного и попробуйте снова.",
    );
    expect(getAuthErrorMessage({ code: "over_request_rate_limit", status: 429 })).toBe(
      "Слишком много попыток входа. Подождите немного и попробуйте снова.",
    );
    expect(getAuthErrorMessage({ code: "email_address_invalid", status: 400 })).toBe(
      "Укажите корректный адрес электронной почты.",
    );
    expect(getAuthErrorMessage({ code: "email_provider_disabled", status: 400 })).toBe(
      "Вход по электронной почте временно отключён. Обратитесь к администратору.",
    );
    expect(getAuthErrorMessage({ code: "captcha_failed", status: 400 })).toBe(
      "Не удалось пройти проверку безопасности. Попробуйте ещё раз.",
    );
    expect(getAuthErrorMessage(new RequestTimeoutError("auth.login", 12_000))).toBe(
      "Сервер не успел ответить. Проверьте подключение и попробуйте снова.",
    );
    expect(getAuthErrorMessage({ status: 503, message: "Service unavailable" })).toBe(
      "Сервис авторизации временно недоступен. Попробуйте позже.",
    );
    expect(getAuthErrorMessage(null)).toBe("Не удалось выполнить вход. Проверьте данные и попробуйте снова.");
  });

  it("maps submit-response failures for network, permission, and response limit cases", () => {
    expect(getSubmitResponseErrorMessage(new Error("fetch failed"))).toBe(
      "Проблема с сетью. Проверьте подключение и отправьте ответ снова.",
    );
    expect(getSubmitResponseErrorMessage(new Error("permission denied"))).toBe(
      "Недостаточно прав для отправки ответа. Обновите страницу или войдите заново.",
    );
    expect(getSubmitResponseErrorMessage(new Error("Лимит ответов достигнут"))).toBe(
      "Лимит ответов для этой формы уже достигнут.",
    );
  });

  it("recognizes aborted requests without treating ordinary errors as cancellations", () => {
    expect(isAbortError(new DOMException("The user aborted a request.", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("fetch failed"))).toBe(false);
  });

  it("shows known PostgREST submission errors without blaming the network or exposing database details", () => {
    expect(getSubmitResponseErrorMessage({ code: "22023", message: "Ответ не соответствует структуре формы", details: "private" }))
      .toBe("Ответ не соответствует структуре формы");
    expect(getSubmitResponseErrorMessage({ code: "22023", message: "Срок загрузки файла истёк. Прикрепите файл заново." }))
      .toBe("Срок загрузки файла истёк. Прикрепите файл заново.");
    expect(getSubmitResponseErrorMessage({ code: "42501", message: "Форма закрыта для ответов" })).toBe("Форма закрыта для ответов");
    expect(getSubmitResponseErrorMessage({ code: "23514", message: "constraint violation" })).not.toContain("Лимит ответов");
    expect(getSubmitResponseErrorMessage({ code: "57014", message: "timeout" })).toContain("не создаст дубликат");
    expect(getSubmitResponseErrorMessage({ code: "413", message: "too large" })).toContain("слишком большой");
    expect(getSubmitResponseErrorMessage({ code: "429", message: "rate limited" })).toContain("Подождите");
    expect(getSubmitResponseErrorMessage({ message: "TypeError: Failed to fetch" })).toContain("Проблема с сетью");
    const generic = getSubmitResponseErrorMessage({ code: "XX000", message: "internal relation secret_table error" });
    expect(generic).not.toMatch(/интернет|secret_table/);
    expect(generic).toContain("сообщите автору формы");
    expect(getSubmitResponseErrorMessage(null)).toBe(generic);
  });
});
