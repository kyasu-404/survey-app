export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallbackMessage;
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
  const fallbackMessage = "Не удалось отправить ответ. Проверьте подключение к интернету и попробуйте ещё раз.";

  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  const message = error.message.toLowerCase();

  if (message.includes("network") || message.includes("fetch")) {
    return "Проблема с сетью. Проверьте подключение и отправьте ответ снова.";
  }

  if (message.includes("auth") || message.includes("permission") || message.includes("forbidden")) {
    return "Недостаточно прав для отправки ответа. Обновите страницу или войдите заново.";
  }

  return fallbackMessage;
}
