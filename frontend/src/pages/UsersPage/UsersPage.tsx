import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createUser, getAllUsers, updateMyPassword } from "../../features/users/api";
import { useToast } from "../../app/providers/ToastProvider";
import { getErrorMessage } from "../../shared/lib/error";
import type { UserRole } from "../../entities/user/types";

type NewUserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export default function UsersPage() {
  const { showToast } = useToast();
  const [newUser, setNewUser] = useState<NewUserForm>({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [newPassword, setNewPassword] = useState("");

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: getAllUsers,
  });

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setNewUser({ name: "", email: "", password: "", role: "user" });
      showToast("Пользователь создан", "success");
      await usersQuery.refetch();
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось создать пользователя"), "error");
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: updateMyPassword,
    onSuccess: () => {
      setNewPassword("");
      showToast("Пароль обновлён", "success");
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось обновить пароль"), "error");
    },
  });

  const isPasswordValid = useMemo(() => newUser.password.length >= 8, [newUser.password.length]);
  const isCurrentPasswordValid = useMemo(() => newPassword.length >= 8, [newPassword.length]);

  const onCreateUser = async () => {
    if (!newUser.name.trim()) {
      showToast("Укажите имя", "error");
      return;
    }

    if (!isPasswordValid) {
      showToast("Пароль должен быть не короче 8 символов", "error");
      return;
    }

    await createUserMutation.mutateAsync({
      ...newUser,
      name: newUser.name.trim(),
      email: newUser.email.trim(),
    });
  };

  const onChangeMyPassword = async () => {
    if (!isCurrentPasswordValid) {
      showToast("Пароль должен быть не короче 8 символов", "error");
      return;
    }

    await updatePasswordMutation.mutateAsync(newPassword);
  };

  return (
    <div className="dashboard-page">
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 4 }}>Пользователи</h2>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 14 }}>
          <input
            value={newUser.name}
            onChange={(e) => setNewUser((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Имя"
          />
          <input
            value={newUser.email}
            onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="Email"
          />
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Пароль (минимум 8 символов)"
          />
          <select
            value={newUser.role}
            onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value as UserRole }))}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>
            Создать пользователя
          </button>
          {!isPasswordValid && newUser.password.length > 0 && (
            <span style={{ color: "#b45309", fontSize: 14 }}>Пароль должен быть не короче 8 символов</span>
          )}
        </div>

        <h3 style={{ marginBottom: 8 }}>Смена моего пароля</h3>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Новый пароль (минимум 8 символов)"
          />
          <button onClick={() => void onChangeMyPassword()} disabled={updatePasswordMutation.isPending || !isCurrentPasswordValid}>
            Сменить пароль
          </button>
        </div>

        <table className="responses-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>Email</th>
              <th>Роль</th>
              <th>Создан</th>
            </tr>
          </thead>
          <tbody>
            {(usersQuery.data ?? []).map((profile) => (
              <tr key={profile.id}>
                <td>{profile.name || "—"}</td>
                <td>{profile.email}</td>
                <td>{profile.role}</td>
                <td>{profile.created_at ? new Date(profile.created_at).toLocaleString("ru-RU") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
