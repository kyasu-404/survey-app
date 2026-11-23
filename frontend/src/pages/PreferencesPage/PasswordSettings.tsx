import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { changeOwnPassword } from "../../features/auth/api";
import { getNewPasswordError, NEW_PASSWORD_MIN_LENGTH } from "../../shared/lib/passwordPolicy";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";

const fields = [
  { key: "current", label: "Текущий пароль", autoComplete: "current-password" },
  { key: "password", label: "Новый пароль", autoComplete: "new-password" },
  { key: "confirmation", label: "Повторите новый пароль", autoComplete: "new-password" },
] as const;

type PasswordField = typeof fields[number]["key"];
type PasswordValues = Record<PasswordField, string>;
type PasswordIssue = { field?: PasswordField; message: string };

const emptyValues: PasswordValues = { current: "", password: "", confirmation: "" };

function validatePassword({ current, password, confirmation }: PasswordValues): PasswordIssue | null {
  if (!current) return { field: "current", message: "Укажите текущий пароль." };
  const passwordError = getNewPasswordError(password);
  if (passwordError) return { field: "password", message: passwordError };
  if (password === current) return { field: "password", message: "Выберите пароль, который отличается от текущего." };
  if (!confirmation) return { field: "confirmation", message: "Повторите новый пароль." };
  if (password !== confirmation) return { field: "confirmation", message: "Пароли не совпадают." };
  return null;
}

function describePasswordError(error: unknown): PasswordIssue {
  const details = typeof error === "object" && error !== null ? error : {};
  const code = "code" in details ? details.code : undefined;
  const status = "status" in details ? details.status : undefined;
  switch (code) {
    case "current_password_invalid":
      return { field: "current", message: "Текущий пароль указан неверно." };
    case "current_password_required":
      return { field: "current", message: "Укажите текущий пароль." };
    case "same_password":
      return { field: "password", message: "Выберите пароль, который отличается от текущего." };
    case "weak_password":
      return { field: "password", message: "Выберите более сложный пароль, который соответствует требованиям сервера." };
    case "reauthentication_needed":
    case "session_expired":
    case "session_not_found":
    case "bad_jwt":
      return { message: "Войдите в систему заново и повторите смену пароля." };
    default:
      if (status === 429) return { message: "Слишком много попыток. Подождите немного и попробуйте снова." };
      if (status === 401 || ("name" in details && details.name === "AuthSessionMissingError")) {
        return { message: "Войдите в систему заново и повторите смену пароля." };
      }
      return { message: "Не удалось подтвердить смену пароля. Проверьте подключение и попробуйте снова." };
  }
}

export function PasswordSettings() {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [values, setValues] = useState(emptyValues);
  const [issue, setIssue] = useState<PasswordIssue | null>(null);
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (issue?.field && !pending) form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
  }, [issue, pending]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    setChanged(false);
    const validation = validatePassword(values);
    setIssue(validation);
    if (validation) return;

    inFlight.current = true;
    setPending(true);
    try {
      await changeOwnPassword(values.current, values.password);
      setValues(emptyValues);
      setChanged(true);
    } catch (error) {
      const failure = describePasswordError(error);
      if (failure.field === "current") setValues(current => ({ ...current, current: "" }));
      setIssue(failure);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <section className="password-settings" aria-labelledby={prefix + "-heading"}>
    <h2 id={prefix + "-heading"}>Смена пароля</h2>
    <p className="activity-muted">Измените пароль для входа в свою учётную запись.</p>
    <form ref={form} noValidate onSubmit={submit} className="password-settings-form">
      {fields.map(({ key, label, autoComplete }) => {
        const id = prefix + "-" + key;
        const fieldError = issue?.field === key ? issue.message : undefined;
        return <div key={key}>
          <label className="activity-field" htmlFor={id}>
            {label}
            <input id={id} name={key} type="password" autoComplete={autoComplete} value={values[key]}
              required disabled={pending} aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? id + "-error" : undefined}
              placeholder={key === "password" ? `Не менее ${NEW_PASSWORD_MIN_LENGTH} символов` : undefined}
              onChange={event => {
                const value = event.currentTarget.value;
                setValues(current => ({ ...current, [key]: value }));
                setIssue(null);
                setChanged(false);
              }} />
          </label>
          {fieldError && <p id={id + "-error"} role="alert" className="activity-error">{fieldError}</p>}
        </div>;
      })}
      {issue && !issue.field && <p role="alert" className="activity-error">{issue.message}</p>}
      {changed && <p role="status">Пароль изменён.</p>}
      <button type="submit" className="button-primary" disabled={pending}>
        {pending && <InlineSpinner />}
        {pending ? "Смена пароля…" : "Сменить пароль"}
      </button>
    </form>
  </section>;
}
