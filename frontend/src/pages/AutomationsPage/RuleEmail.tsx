import { useRef, useState } from "react";
import type { EmailAction } from "../../entities/automation/model";

const tokenGroups = [
  { title: "Форма", values: { form_title: "Название формы", form_link: "Ссылка на ответы формы" } },
  { title: "Ответ", values: { respondent: "Респондент", response_link: "Ссылка на ответ", response_time: "Время получения ответа" } },
  { title: "Отправка и статистика", values: { sent_at: "Время отправки письма", answer_count: "Всего ответов" } },
];
const matchingValues = { matching_count: "Ответов по условиям", matching_percent: "Доля ответов по условиям" };

type TemplateProps = {
  subject: string;
  body: string;
  hasThreshold: boolean;
  onSubject: (value: string) => void;
  onBody: (value: string) => void;
};

export function RuleEmailTemplate({ subject, body, hasThreshold, onSubject, onBody }: TemplateProps) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [target, setTarget] = useState<"subject" | "body">("body");
  const [limitError, setLimitError] = useState("");
  const groups = hasThreshold ? [...tokenGroups, { title: "Порог", values: matchingValues }] : tokenGroups;

  function insertToken(key: string) {
    const input = target === "subject" ? subjectRef.current : bodyRef.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const token = "{{" + key + "}}";
    const value = input.value.slice(0, start) + token + input.value.slice(end);
    if (value.length > input.maxLength) {
      setLimitError("Достигнут предел длины поля. Сократите текст перед вставкой.");
      return;
    }
    setLimitError("");
    if (target === "subject") onSubject(value);
    else onBody(value);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return <>
    <label className="activity-field">Тема
      <input ref={subjectRef} required maxLength={500} value={subject} onFocus={() => setTarget("subject")}
        onChange={change => { setLimitError(""); onSubject(change.target.value); }} />
    </label>
    <label className="activity-field">Текст письма
      <textarea ref={bodyRef} required rows={3} maxLength={10000} value={body} onFocus={() => setTarget("body")}
        onChange={change => { setLimitError(""); onBody(change.target.value); }} />
    </label>
    <details className="activity-variables rule-variables">
      <summary>Подстановки</summary>
      <label className="activity-field">Куда вставить
        <select value={target} onChange={(event) => setTarget(event.target.value as typeof target)}>
          <option value="subject">В тему письма</option><option value="body">В текст письма</option>
        </select>
      </label>
      {groups.map((group) => <div className="rule-variable-group" key={group.title}>
        <strong>{group.title}</strong>
        <div className="activity-actions">
          {Object.entries(group.values).map(([key, label]) => <button key={key} className="app-button" type="button"
            title={"{{" + key + "}}"} onClick={() => insertToken(key)}>{label}</button>)}
        </div>
      </div>)}
      {limitError && <p className="activity-error" role="alert">{limitError}</p>}
    </details>
  </>;
}

type PreviewProps = {
  subject: string;
  body: string;
  mode: EmailAction["mode"];
  formTitle?: string;
  recipients: string[];
  recipientField?: string;
  hasThreshold: boolean;
};

export function RuleEmailPreview({ subject, body, mode, formTitle, recipients, recipientField, hasThreshold }: PreviewProps) {
  const formLink = "https://example.org/dashboard/forms/demo/responses";
  const responseLink = formLink + "?response=demo";
  const values: Record<string, string> = {
    form_title: formTitle || "Учебная форма", form_link: formLink, response_link: responseLink,
    respondent: "Анна Иванова", response_time: "16.09.2026 10:30 МСК", sent_at: "16.09.2026 10:31 МСК",
    answer_count: "12", matching_count: hasThreshold ? "3" : "—", matching_percent: hasThreshold ? "25%" : "—",
  };
  const render = (template: string) => template.replace(/\{\{([a-z_]+)\}\}/g,
    (original, key: string) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : original);
  const message = render(body);
  return <section className="rule-preview">
    <h3>Пример письма</h3>
    <p className="activity-muted">Предпросмотр на условных данных. При отправке подставятся значения события.</p>
    <dl>
      <dt>Кому</dt><dd>{[...recipients, ...(recipientField ? ["Адрес из ответа на вопрос «" + recipientField + "»"] : [])].join(", ")}</dd>
      <dt>Тема</dt><dd>{render(subject)}</dd>
    </dl>
    <div className="rule-preview-body">{message}
      {!message.includes(responseLink) && <p>{responseLink}</p>}
      {mode === "full" && <p>Ответ:<br />Пример вопроса: Пример ответа</p>}
    </div>
  </section>;
}
