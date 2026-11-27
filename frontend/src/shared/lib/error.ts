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

function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message.trim();
  }

  return "";
}

export function getAuthErrorMessage(error: unknown) {
  const fallbackMessage = "Не удалось выполнить вход. Проверьте данные и попробуйте снова.";

  if (typeof error !== "object" || error === null) {
    return fallbackMessage;
  }

  const details = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const code = typeof details.code === "string" ? details.code.trim().toLowerCase() : "";
  const status = typeof details.status === "number" ? details.status : undefined;
  const name = typeof details.name === "string" ? details.name : "";
  const normalizedMessage = getErrorText(error).toLowerCase();

  if (
    code === "invalid_credentials" ||
    name === "AuthInvalidCredentialsError" ||
    normalizedMessage.includes("invalid login credentials") ||
    normalizedMessage.includes("invalid_credentials")
  ) {
    return "Неверная почта или пароль.";
  }

  if (
    code === "user_banned" ||
    normalizedMessage.includes("user is banned") ||
    normalizedMessage.includes("user has been banned") ||
    normalizedMessage.includes("user_banned")
  ) {
    return "Учётная запись отключена. Обратитесь к администратору.";
  }

  if (code === "email_not_confirmed" || normalizedMessage.includes("email not confirmed")) {
    return "Подтвердите адрес электронной почты перед входом.";
  }

  if (
    code === "over_request_rate_limit" ||
    status === 429 ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("rate limit")
  ) {
    return "Слишком много попыток входа. Подождите немного и попробуйте снова.";
  }

  if (
    code === "email_address_invalid" ||
    normalizedMessage.includes("unable to validate email") ||
    normalizedMessage.includes("invalid email")
  ) {
    return "Укажите корректный адрес электронной почты.";
  }

  if (code === "email_provider_disabled" || code === "provider_disabled") {
    return "Вход по электронной почте временно отключён. Обратитесь к администратору.";
  }

  if (code === "captcha_failed" || normalizedMessage.includes("captcha")) {
    return "Не удалось пройти проверку безопасности. Попробуйте ещё раз.";
  }

  if (code === "user_not_found" || normalizedMessage.includes("user not found")) {
    return "Пользователь с такой почтой не найден.";
  }

  if (
    name === "RequestTimeoutError" ||
    code === "request_timeout" ||
    code === "hook_timeout" ||
    code === "hook_timeout_after_retry" ||
    status === 408 ||
    status === 504 ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("таймаут")
  ) {
    return "Сервер не успел ответить. Проверьте подключение и попробуйте снова.";
  }

  if (
    name === "AuthRetryableFetchError" ||
    status === 0 ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("fetch") ||
    normalizedMessage.includes("load failed") ||
    normalizedMessage.includes("offline")
  ) {
    return "Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.";
  }

  if ((status !== undefined && status >= 500) || code === "unexpected_failure") {
    return "Сервис авторизации временно недоступен. Попробуйте позже.";
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
