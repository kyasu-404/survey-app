import { useState } from "react";
import { login, register } from "../../features/auth/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function onLogin() {
    try {
      await login(email, password);
      setMessage("Вход выполнен");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function onRegister() {
    try {
      await register(email, password);
      setMessage("Регистрация выполнена");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <div style={{ maxWidth: 320 }}>
      <h2>Вход</h2>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Пароль"
        type="password"
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={onLogin}>Войти</button>
        <button onClick={onRegister}>Регистрация</button>
      </div>
      {message && <p>{message}</p>}
    </div>
  );
}
