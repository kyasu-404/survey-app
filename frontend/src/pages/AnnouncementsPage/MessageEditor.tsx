import { useId, useRef, useState } from "react";

const listPrefix = /^\s*[-*]\s+/;
const emphasis = /^(\*{1,3})([^*]+)\1$/;

export function MessageEditor({ value, onChange }: { value: string; onChange: (message: string) => void }) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [limitError, setLimitError] = useState(false);
  function format(marker: "**" | "*" | "- ") {
    const input = textarea.current;
    if (!input) return;
    const current = input.value;
    let start = input.selectionStart;
    let end = input.selectionEnd;
    const lineStart = start === 0 ? 0 : current.lastIndexOf("\n", start - 1) + 1;
    let replacement: string;
    let selectedStart: number;
    let selectedEnd: number;
    if (marker === "- ") {
      // A list marker belongs at the start of a line, including for a partial selection.
      const lastCharacter = end > start && current[end - 1] === "\n" ? end - 1 : end;
      start = lineStart;
      const nextLine = current.indexOf("\n", lastCharacter);
      end = nextLine === -1 ? current.length : nextLine;
      const lines = current.slice(start, end).split("\n").map(line => listPrefix.test(line)
        ? line : "- " + (line || "Пункт списка"));
      replacement = lines.join("\n");
      const firstPrefixLength = listPrefix.exec(lines[0])?.[0].length ?? 0;
      selectedStart = start + (lines.length === 1 ? firstPrefixLength : 0);
      selectedEnd = start + replacement.length;
    } else {
      // A previous formatting action selects the content between the delimiters.
      if (end > start && !/[\n*]/.test(current.slice(start, end))) {
        const opening = /\*+$/.exec(current.slice(lineStart, start))?.[0];
        const closing = /^\*+/.exec(current.slice(end))?.[0];
        if (opening && opening.length <= 3 && opening === closing) {
          start -= opening.length;
          end += closing.length;
        }
      }
      const selection = current.slice(start, end) || (marker === "**" ? "Полужирный текст" : "Текст курсивом");
      const startsAtListPrefix = !current.slice(lineStart, start).trim();
      const lines = selection.split("\n");
      // Keep complete lines selected together; a single line selects only the formatted content.
      selectedStart = start;
      selectedEnd = start;
      replacement = lines.map((line, index) => {
        const bullet = index > 0 || startsAtListPrefix ? listPrefix.exec(line)?.[0] ?? "" : "";
        const plain = line.slice(bullet.length);
        const formatted = emphasis.exec(plain);
        const active = formatted?.[1] ?? "";
        const content = formatted?.[2] ?? plain;
        if (!content.trim()) return line;
        const delimiter = active === marker || active === "***" ? active.slice(marker.length) : active + marker;
        if (lines.length === 1) {
          selectedStart = start + bullet.length + delimiter.length;
          selectedEnd = selectedStart + content.length;
        }
        return bullet + delimiter + content + delimiter;
      }).join("\n");
      if (selectedEnd === start) selectedEnd = start + replacement.length;
    }
    const next = current.slice(0, start) + replacement + current.slice(end);
    if (next.length > input.maxLength) { setLimitError(true); return; }
    setLimitError(false);
    input.focus();
    input.setSelectionRange(start, end);
    // Native text insertion participates in the same undo history as typing.
    if (!document.execCommand?.("insertText", false, replacement)) onChange(next);
    requestAnimationFrame(() => input.setSelectionRange(selectedStart, selectedEnd));
  }
  return <div className="activity-field">
    <label htmlFor={id}>Текст объявления</label>
    <div className="announcement-compose">
      <div role="group" aria-label="Форматирование текста" className="announcement-format">
        <button type="button" aria-label="Полужирный" title="Полужирный" onClick={() => format("**")}><strong>Ж</strong></button>
        <button type="button" aria-label="Курсив" title="Курсив" onClick={() => format("*")}><em>К</em></button>
        <button type="button" aria-label="Маркированный список" title="Маркированный список" onClick={() => format("- ")}>• Список</button>
      </div>
      <textarea id={id} ref={textarea} rows={5} required maxLength={12000}
        placeholder="Что важно сообщить пользователям?" value={value} onChange={event => { setLimitError(false); onChange(event.target.value); }} />
    </div>
    {limitError && <p className="activity-error" role="alert">Сократите текст перед форматированием. Максимум — 12 000 символов.</p>}
  </div>;
}
