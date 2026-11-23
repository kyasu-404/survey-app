export const NEW_PASSWORD_MIN_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

export function getNewPasswordError(password: string) {
  if (Array.from(password).length < NEW_PASSWORD_MIN_LENGTH) {
    return `Новый пароль должен содержать не менее ${NEW_PASSWORD_MIN_LENGTH} символов.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Сократите новый пароль: в кодировке UTF-8 он должен занимать не более ${MAX_PASSWORD_BYTES} байт.`;
  }
  return null;
}
