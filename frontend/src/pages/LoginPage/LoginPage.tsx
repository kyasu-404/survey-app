import { useId, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, type Path } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";
import { login } from "../../features/auth/api";
import { getAuthErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";

type LoginField = "email" | "password";
type LoginIssue = { field?: LoginField; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSafeLoginTarget(value: unknown) {
  return typeof value === "string"
    && value.startsWith("/")
    && value !== routes.home
    && !value.startsWith("//")
    && !value.includes("\\")
    ? value
    : routes.dashboardMy;
}

export function getWelcomeMessage(displayName: string) {
  const normalizedName = displayName.trim();
  return normalizedName ? `Добро пожаловать, ${normalizedName}` : "Добро пожаловать!";
}

function validateLogin(email: string, password: string): LoginIssue | null {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return { field: "email", message: "Укажите электронную почту." };
  }
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    return { field: "email", message: "Укажите корректный адрес электронной почты." };
  }
  if (!password) {
    return { field: "password", message: "Введите пароль." };
  }
  return null;
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83" />
        <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.9c6 0 9.5 7.1 9.5 7.1a18.8 18.8 0 0 1-3.12 4.18" />
        <path d="M6.61 6.61A18.9 18.9 0 0 0 2.5 12s3.5 7.1 9.5 7.1a10.6 10.6 0 0 0 5.39-1.46" />
        <path d="M3 3l18 18" />
      </svg>
    );
  }

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.5 12S6 4.9 12 4.9 21.5 12 21.5 12 18 19.1 12 19.1 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [issue, setIssue] = useState<LoginIssue | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlightRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Partial<Path> } | null)?.from;
  const pathname = getSafeLoginTarget(from?.pathname);
  const targetPath = pathname === from?.pathname
    ? { pathname, search: from.search, hash: from.hash }
    : pathname;

  if (!loading && user && !isSubmitting) {
    return <Navigate to={targetPath} replace />;
  }

  const emailError = issue?.field === "email" ? issue.message : undefined;
  const passwordError = issue?.field === "password" ? issue.message : undefined;

  async function onLogin() {
    if (inFlightRef.current) return;

    const submittedEmail = emailInputRef.current?.value ?? email;
    const submittedPassword = passwordInputRef.current?.value ?? password;
    if (submittedEmail !== email) setEmail(submittedEmail);
    if (submittedPassword !== password) setPassword(submittedPassword);

    const validation = validateLogin(submittedEmail, submittedPassword);
    if (validation) {
      setIssue(validation);
      if (validation.field === "email") {
        emailInputRef.current?.focus();
      } else if (validation.field === "password") {
        passwordInputRef.current?.focus();
      }
      return;
    }

    inFlightRef.current = true;
    setIsSubmitting(true);
    setIssue(null);
    let didNavigate = false;
    try {
      const displayName = await login(submittedEmail, submittedPassword);
      didNavigate = true;
      navigate(targetPath, {
        replace: true,
        state: { toast: getWelcomeMessage(displayName) },
      });
    } catch (error) {
      setIssue({ message: getAuthErrorMessage(error) });
    } finally {
      if (!didNavigate) {
        inFlightRef.current = false;
        setIsSubmitting(false);
      }
    }
  }

  const emailInputId = `${fieldId}-email`;
  const passwordInputId = `${fieldId}-password`;

  return (
    <div className="login-page">
      <div className="card login-card">
        <h1 className="login-title">Вход в систему</h1>
        <form
          className="login-form"
          method="post"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin();
          }}
        >
          <div className="login-fields">
            <label htmlFor={emailInputId}>Электронная почта</label>
            <input
              ref={emailInputRef}
              id={emailInputId}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setIssue(null);
              }}
              placeholder="Электронная почта"
              required
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${emailInputId}-error` : undefined}
            />
            {emailError && (
              <p id={`${emailInputId}-error`} role="alert" className="login-field-error">
                {emailError}
              </p>
            )}
            <label htmlFor={passwordInputId}>Пароль</label>
            <div className="login-password-field">
              <input
                ref={passwordInputRef}
                id={passwordInputId}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setIssue(null);
                }}
                placeholder="Пароль"
                required
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? `${passwordInputId}-error` : undefined}
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                aria-pressed={showPassword}
                aria-controls={passwordInputId}
                title={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                <PasswordVisibilityIcon visible={showPassword} />
              </button>
            </div>
            {passwordError && (
              <p id={`${passwordInputId}-error`} role="alert" className="login-field-error">
                {passwordError}
              </p>
            )}
          </div>
          <div className="login-actions">
            <button
              type="submit"
              className="button-primary login-submit-button"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting && <InlineSpinner />}
              {isSubmitting ? "Вход…" : "Войти"}
            </button>
          </div>
        </form>
        {issue && !issue.field && (
          <p role="alert" className="login-message login-message-error">
            {issue.message}
          </p>
        )}
      </div>
    </div>
  );
}
