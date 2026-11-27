export function isUpstreamUnavailable(status) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function authFailure(error) {
  const status = Number(error?.status);
  const code = error?.code;
  if (error?.name === "AuthRetryableFetchError" || error?.name === "AuthUnknownError" ||
      isUpstreamUnavailable(status)) {
    return { status: 503, code: "auth_unavailable", message: "Сервис авторизации временно недоступен" };
  }
  if (code === "user_banned") {
    return { status: 403, code, message: "Учётная запись отключена" };
  }
  if (error?.name === "AuthSessionMissingError" || code === "session_not_found" || code === "user_not_found") {
    return { status: 401, code: "session_not_found", message: "Сессия отозвана. Войдите снова." };
  }
  if (code === "session_expired") {
    return { status: 401, code, message: "Срок действия сессии истёк. Войдите снова." };
  }
  if (/\b(jwt|token) (?:is |has )?expired\b|\binvalid claim: exp\b/i.test(error?.message ?? "")) {
    return { status: 401, code: "token_expired", message: "Истёк срок действия токена" };
  }
  if (status === 403 && code !== "bad_jwt" && code !== "no_authorization") {
    return { status: 403, code: "forbidden", message: "Недостаточно прав для этой операции" };
  }
  return { status: 401, code: "token_rejected", message: "Токен авторизации отклонён" };
}
