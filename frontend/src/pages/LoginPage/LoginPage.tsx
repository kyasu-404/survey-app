import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";
import { login } from "../../features/auth/api";
import { getAuthErrorMessage } from "../../shared/lib/error";

type MessageType = "success" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("success");
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const targetPath = from ?? routes.dashboardMy;

  if (!loading && user) {
    return <Navigate to={targetPath} replace />;
  }

  async function onLogin() {
    try {
      setMessage("");
      await login(email, password);
      navigate(targetPath, {
        replace: true,
        state: { toast: `Добро пожаловать, ${email}` },
      });
    } catch (error) {
      setMessageType("error");
      setMessage(getAuthErrorMessage(error));
    }
  }

  return (
    <div className="login-page">
      <div className="card" style={{ padding: 20, width: "min(420px, 100%)" }}>
        <h2 className="login-title">Авторизация</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onLogin();
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Электронная почта" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" type="password" />
          </div>
          <div className="login-actions">
            <button type="submit">Войти</button>
          </div>
        </form>
        {message && (
          <p
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: messageType === "error" ? "#fee2e2" : "#dbeafe",
              color: messageType === "error" ? "#991b1b" : "#1d4ed8",
            }}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
