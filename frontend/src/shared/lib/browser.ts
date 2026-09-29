export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A modal dialog makes the rest of the document inert, including a body-level fallback.
  const host = previousFocus?.closest("dialog[open]") ?? document.body;
  host.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    return document.execCommand("copy");
  } finally {
    textarea.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
