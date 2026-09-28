export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
}

export function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    error.name === "AbortError"
  );
}

export function getAuthErrorMessage(error: unknown) {
  const fallbackMessage = "Не удалось выполнить вход. Проверьте данные и попробуйте снова.";

  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const normalizedMessage = error.message.trim().toLowerCase();

  if (normalizedMessage.includes("invalid login credentials")) {
    return "Неверная почта или пароль.";
  }

  if (normalizedMessage.includes("email not confirmed")) {
    return "Подтвердите адрес электронной почты перед входом.";
  }

  if (normalizedMessage.includes("network") || normalizedMessage.includes("fetch")) {
    return "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.";
  }

  if (normalizedMessage.includes("too many requests")) {
    return "Слишком много попыток входа. Подождите немного и попробуйте снова.";
  }

  if (normalizedMessage.includes("user not found")) {
    return "Пользователь с такой почтой не найден.";
  }

  return fallbackMessage;
}

export function getSubmitResponseErrorMessage(error: unknown) {
  const fallbackMessage = "Не удалось отправить ответ. Попробуйте ещё раз. Если ошибка повторится, сообщите автору формы.";

  // PostgREST returns a plain object, not an Error instance.
  if (typeof error !== "object" || error === null || !("message" in error) || typeof error.message !== "string") {
    return fallbackMessage;
  }

  const message = error.message.trim().toLowerCase();
  const code = "code" in error && typeof error.code === "string" ? error.code : "";

  // Our RPC validation errors use Russian messages intended for respondents.
  // Internal SQL errors and diagnostic details still use the generic fallback.
  if (["22023", "42501", "P0002"].includes(code) && /^[А-ЯЁ]/.test(error.message.trim())) {
    return error.message.trim();
  }

  if (message.includes("timeout") || message.includes("timed out") || message.includes("таймаут") || code === "57014") {
    return "Сервер не успел ответить. Отправьте ответ снова — повторная отправка не создаст дубликат.";
  }
  if (code === "54000" || code === "413") return "Ответ слишком большой. Уменьшите его объём и попробуйте снова.";
  if (code === "429" || message.includes("too many requests")) return "Слишком много запросов. Подождите немного и отправьте ответ снова.";

  if (message.includes("network") || message.includes("fetch")) {
    return "Проблема с сетью. Проверьте подключение и отправьте ответ снова.";
  }

  if (code === "42501" || message.includes("auth") || message.includes("permission") || message.includes("forbidden")) {
    return "Недостаточно прав для отправки ответа. Обновите страницу или войдите заново.";
  }

  if (message.includes("лимит ответов")) {
    return "Лимит ответов для этой формы уже достигнут.";
  }

  return fallbackMessage;
}
