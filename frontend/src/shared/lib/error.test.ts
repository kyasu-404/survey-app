import { describe, expect, it } from "vitest";
import { getAuthErrorMessage, getErrorMessage, getSubmitResponseErrorMessage } from "./error";

describe("error helpers", () => {
  it("prefers a concrete Error message over the fallback", () => {
    expect(getErrorMessage(new Error("Точное сообщение"), "Запасной текст")).toBe("Точное сообщение");
    expect(getErrorMessage({ message: "ignored" }, "Запасной текст")).toBe("Запасной текст");
  });

  it("maps common auth API failures to user-facing Russian messages", () => {
    expect(getAuthErrorMessage(new Error("Invalid login credentials"))).toBe("Неверная почта или пароль.");
    expect(getAuthErrorMessage(new Error("Email not confirmed"))).toBe(
      "Подтвердите адрес электронной почты перед входом.",
    );
    expect(getAuthErrorMessage(new Error("Network request failed"))).toBe(
      "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.",
    );
    expect(getAuthErrorMessage(new Error("Too many requests"))).toBe(
      "Слишком много попыток входа. Подождите немного и попробуйте снова.",
    );
  });

  it("maps submit-response failures for network, permission, and response limit cases", () => {
    expect(getSubmitResponseErrorMessage(new Error("fetch failed"))).toBe(
      "Проблема с сетью. Проверьте подключение и отправьте ответ снова.",
    );
    expect(getSubmitResponseErrorMessage(new Error("permission denied"))).toBe(
      "Недостаточно прав для отправки ответа. Обновите страницу или войдите заново.",
    );
    expect(getSubmitResponseErrorMessage(new Error("23514 check violation"))).toBe(
      "Лимит ответов для этой формы уже достигнут.",
    );
  });
});
