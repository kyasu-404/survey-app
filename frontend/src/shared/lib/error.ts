export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
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
