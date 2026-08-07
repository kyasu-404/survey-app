import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";
import { login } from "../../features/auth/api";
import { getAuthErrorMessage } from "../../shared/lib/error";

type MessageType = "success" | "error";

export function getSafeLoginTarget(value: unknown) {
  return typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
    && !value.includes("\\")
    ? value
    : routes.dashboardMy;
}

export function getWelcomeMessage(displayName: string) {
  const normalizedName = displayName.trim();
  return normalizedName ? `Добро пожаловать, ${normalizedName}` : "Добро пожаловать!";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("success");
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const targetPath = getSafeLoginTarget(from);

  if (!loading && user) {
    return <Navigate to={targetPath} replace />;
  }

  async function onLogin() {
    try {
      setMessage("");
      const displayName = await login(email, password);
      navigate(targetPath, {
        replace: true,
        state: { toast: getWelcomeMessage(displayName) },
      });
    } catch (error) {
      setMessageType("error");
      setMessage(getAuthErrorMessage(error));
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <h2 className="login-title">Авторизация</h2>
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin();
          }}
        >
          <div className="login-fields">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Электронная почта" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" />
          </div>
          <div className="login-actions">
            <button type="submit" className="button-primary">Войти</button>
          </div>
        </form>
        {message && (
          <p className={`login-message login-message-${messageType}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
