import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, register } from "../../features/auth/api";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";

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
  const targetPath = from ?? routes.home;

  if (!loading && user) {
    return <Navigate to={targetPath} replace />;
  }

  async function onLogin() {
    try {
      await login(email, password);
      navigate(targetPath, {
        replace: true,
        state: { toast: `Добро пожаловать, ${email}` }
      });
    } catch (error) {
      setMessageType("error");
      setMessage((error as Error).message);
    }
  }

  async function onRegister() {
    try {
      await register(email, password);
      navigate(targetPath, {
        replace: true,
        state: { toast: "Вы успешно вошли" }
      });
    } catch (error) {
      setMessageType("error");
      setMessage((error as Error).message);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto" }}>
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 4 }}>Авторизация</h2>
        <div style={{ display: "grid", gap: 10 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Электронная почта" />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            type="password"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onLogin}>Войти</button>
          <button onClick={onRegister}>Зарегистрироваться</button>
        </div>
        {message && (
          <p
            style={{
              marginTop: 12,
              padding: 10,
              borderRadius: 8,
              background: messageType === "error" ? "#fee2e2" : "#dcfce7",
              color: messageType === "error" ? "#991b1b" : "#166534"
            }}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
