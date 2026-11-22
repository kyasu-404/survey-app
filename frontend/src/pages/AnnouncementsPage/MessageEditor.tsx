import { useRef, useState } from "react";

export function MessageEditor({ value, onChange }: { value: string; onChange: (message: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [limitError, setLimitError] = useState(false);
  function format(marker: "**" | "*" | "- ") {
    const input = textarea.current;
    if (!input) return;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    let replacement: string;
    let selectedStart: number;
    let selectedEnd: number;
    if (marker === "- ") {
      // A list marker belongs at the start of a line, including for a partial selection.
      const lastCharacter = end > start && value[end - 1] === "\n" ? end - 1 : end;
      start = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
      const nextLine = value.indexOf("\n", lastCharacter);
      end = nextLine === -1 ? value.length : nextLine;
      const lines = value.slice(start, end).split("\n");
      replacement = lines.map(line => /^\s*[-*]\s+/.test(line)
        ? line : "- " + (line || "Пункт списка")).join("\n");
      selectedStart = start + 2;
      selectedEnd = start + replacement.length;
    } else {
      const selection = value.slice(start, end) || (marker === "**" ? "Полужирный текст" : "Текст курсивом");
      replacement = selection.split("\n").map(line => {
        if (!line.trim()) return line;
        const bullet = /^\s*[-*]\s+/.exec(line)?.[0] ?? "";
        const content = line.slice(bullet.length);
        return bullet + marker + content + marker;
      }).join("\n");
      selectedStart = start + marker.length;
      selectedEnd = start + replacement.length - marker.length;
    }
    const next = value.slice(0, start) + replacement + value.slice(end);
    if (next.length > input.maxLength) { setLimitError(true); return; }
    setLimitError(false);
    input.focus();
    input.setSelectionRange(start, end);
    // Native text insertion participates in the same undo history as typing.
    if (!document.execCommand?.("insertText", false, replacement)) onChange(next);
    requestAnimationFrame(() => input.setSelectionRange(selectedStart, selectedEnd));
  }
  return <div className="activity-field">
    <label htmlFor="announcement-message">Текст объявления</label>
    <div className="announcement-compose">
      <div role="group" aria-label="Форматирование текста" className="announcement-format">
        <button type="button" aria-label="Полужирный" title="Полужирный" onClick={() => format("**")}><strong>Ж</strong></button>
        <button type="button" aria-label="Курсив" title="Курсив" onClick={() => format("*")}><em>К</em></button>
        <button type="button" aria-label="Маркированный список" title="Маркированный список" onClick={() => format("- ")}>• Список</button>
      </div>
      <textarea id="announcement-message" ref={textarea} rows={5} required maxLength={12000}
        placeholder="Что важно сообщить пользователям?" value={value} onChange={event => { setLimitError(false); onChange(event.target.value); }} />
    </div>
    {limitError && <p className="activity-error" role="alert">Сократите текст перед форматированием. Максимум — 12 000 символов.</p>}
  </div>;
}
