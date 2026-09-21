const RESPONSE_BROWSER_ID_KEY = "survey-response:browser-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function getOrCreateResponseBrowserId() {
  const browserId = createUuid();

  if (typeof window === "undefined") {
    return browserId;
  }

  try {
    const savedBrowserId = window.localStorage.getItem(RESPONSE_BROWSER_ID_KEY);
    if (savedBrowserId && UUID_PATTERN.test(savedBrowserId)) {
      return savedBrowserId;
    }

    window.localStorage.setItem(RESPONSE_BROWSER_ID_KEY, browserId);
  } catch (error) {
    console.warn("Не удалось сохранить идентификатор браузера для ответа", error);
  }

  return browserId;
}
