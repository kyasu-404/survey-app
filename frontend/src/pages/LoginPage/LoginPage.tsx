import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";
import { login } from "../../features/auth/api";
import { getAuthErrorMessage } from "../../shared/lib/error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
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
      setMessage(getAuthErrorMessage(error));
    }
  }

  return (
    <div className="login-shell">
      <section className="login-showcase">
        <p className="login-kicker">Editorial Warm</p>
        <h1 className="login-showcase-title">Формы для команды</h1>
        <p>Единое пространство для рабочих форм, заметок и согласований в привычном теплым редакционном стиле.</p>
        <div className="login-showcase-points" aria-label="Преимущества входа">
          <span>Быстрый доступ</span>
          <span>Командные сценарии</span>
          <span>Удобная авторизация</span>
        </div>
      </section>
      <section className="login-card">
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
        {message && <p className="inline-feedback inline-feedback-error">{message}</p>}
      </section>
    </div>
  );
}
