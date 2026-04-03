import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUser,
  deleteUser,
  getAllUsers,
  setUserDisabled,
  updateMyPassword,
  updateUserPassword,
} from "../../features/users/api";
import { useToast } from "../../app/providers/ToastProvider";
import { getErrorMessage } from "../../shared/lib/error";
import { useAuth } from "../../app/providers/AuthProvider";
import type { UserRole } from "../../entities/user/types";

type NewUserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

type PasswordModalState = {
  userId: string;
  title: string;
  password: string;
  isOwnPassword: boolean;
};

type DeleteUserModalState = {
  userId: string;
  userName: string;
};

export default function UsersPage() {
  const { showToast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const [newUser, setNewUser] = useState<NewUserForm>({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [deleteUserModal, setDeleteUserModal] = useState<DeleteUserModalState | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: getAllUsers,
    enabled: !isAuthLoading && Boolean(user),
  });

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setNewUser({ name: "", email: "", password: "", role: "user" });
      showToast("Пользователь создан", "success");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось создать пользователя"), "error");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: async () => {
      showToast("Пользователь удалён", "success");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось удалить пользователя"), "error");
    },
  });

  const setUserDisabledMutation = useMutation({
    mutationFn: ({ userId, disabled }: { userId: string; disabled: boolean }) => setUserDisabled(userId, disabled),
    onSuccess: async (_data, variables) => {
      showToast(variables.disabled ? "Пользователь отключён" : "Пользователь включён", "success");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось изменить статус пользователя"), "error");
    },
  });

  const updateUserPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) => updateUserPassword(userId, password),
    onSuccess: () => {
      setPasswordModal(null);
      showToast("Пароль пользователя обновлён", "success");
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось обновить пароль пользователя"), "error");
    },
  });

  const updatePasswordMutation = useMutation({
    mutationFn: updateMyPassword,
    onSuccess: () => {
      setPasswordModal(null);
      showToast("Пароль обновлён", "success");
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось обновить пароль"), "error");
    },
  });

  const isPasswordValid = useMemo(() => newUser.password.length >= 8, [newUser.password.length]);
  const isModalPasswordValid = useMemo(() => (passwordModal?.password.length ?? 0) >= 8, [passwordModal?.password.length]);

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

  const openPasswordModal = (userId: string, title: string, isOwnPassword: boolean) => {
    setPasswordModal({
      userId,
      title,
      password: "",
      isOwnPassword,
    });
  };

  const onChangePassword = async () => {
    if (!passwordModal) {
      return;
    }

    if (!isModalPasswordValid) {
      showToast("Пароль должен быть не короче 8 символов", "error");
      return;
    }

    if (passwordModal.isOwnPassword) {
      await updatePasswordMutation.mutateAsync(passwordModal.password);
      return;
    }

    await updateUserPasswordMutation.mutateAsync({
      userId: passwordModal.userId,
      password: passwordModal.password,
    });
  };

  return (
    <div className="dashboard-page">
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 4 }}>Пользователи</h2>

        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 14 }}>
          <input value={newUser.name} onChange={(e) => setNewUser((prev) => ({ ...prev, name: e.target.value }))} placeholder="Имя" />
          <input value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" />
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Пароль (минимум 8 символов)"
          />
          <select value={newUser.role} onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value as UserRole }))}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>
            Создать пользователя
          </button>
          <button onClick={() => openPasswordModal(user?.id ?? "", "Смена моего пароля", true)} disabled={!user}>
            Сменить мой пароль
          </button>
          {!isPasswordValid && newUser.password.length > 0 && (
            <span style={{ color: "#b45309", fontSize: 14 }}>Пароль должен быть не короче 8 символов</span>
          )}
        </div>

        {isAuthLoading || usersQuery.isLoading ? (
          <p style={{ margin: "8px 0 0", color: "#334155" }}>Загрузка пользователей...</p>
        ) : !user ? (
          <p style={{ margin: "8px 0 0", color: "#b45309" }}>Требуется авторизация для просмотра пользователей.</p>
        ) : usersQuery.isError ? (
          <div style={{ marginTop: 8, color: "#b91c1c" }}>
            <p style={{ margin: 0 }}>{getErrorMessage(usersQuery.error, "Не удалось загрузить пользователей")}</p>
            <button onClick={() => void usersQuery.refetch()} style={{ marginTop: 8 }}>
              Повторить
            </button>
          </div>
        ) : (
          <table className="responses-table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Создан</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {(usersQuery.data ?? []).map((profile) => {
                const isOwnUser = profile.id === user?.id;

                return (
                  <tr key={profile.id}>
                    <td>{profile.name || "—"}</td>
                    <td>{profile.email}</td>
                    <td>{profile.role}</td>
                    <td>
                      <span className={profile.is_disabled ? "user-status-disabled" : "user-status-active"}>
                        {profile.is_disabled ? "Отключён" : "Активен"}
                      </span>
                    </td>
                    <td>{profile.created_at ? new Date(profile.created_at).toLocaleString("ru-RU") : "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          onClick={() =>
                            openPasswordModal(
                              profile.id,
                              isOwnUser ? "Смена моего пароля" : `Смена пароля: ${profile.name || profile.email}`,
                              isOwnUser,
                            )
                          }
                        >
                          Сменить пароль
                        </button>
                        <button
                          onClick={() =>
                            void setUserDisabledMutation.mutateAsync({
                              userId: profile.id,
                              disabled: !profile.is_disabled,
                            })
                          }
                          disabled={setUserDisabledMutation.isPending || isOwnUser}
                        >
                          {profile.is_disabled ? "Включить" : "Отключить"}
                        </button>
                        <button
                          onClick={() =>
                            setDeleteUserModal({
                              userId: profile.id,
                              userName: profile.name || profile.email,
                            })
                          }
                          disabled={deleteUserMutation.isPending || isOwnUser}
                        >
                          Удалить
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {passwordModal && (
        <div className="modal-backdrop">
          <div className="modal-card card">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>{passwordModal.title}</h3>
            <label className="deadline-field">
              <span>Новый пароль</span>
              <input
                type="password"
                value={passwordModal.password}
                onChange={(e) =>
                  setPasswordModal((prev) =>
                    prev
                      ? {
                          ...prev,
                          password: e.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Минимум 8 символов"
              />
            </label>
            <div className="deadline-modal-actions">
              <button onClick={() => setPasswordModal(null)}>Отмена</button>
              <button onClick={() => void onChangePassword()} disabled={updatePasswordMutation.isPending || updateUserPasswordMutation.isPending || !isModalPasswordValid}>
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card card">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Удаление пользователя</h3>
            <p style={{ marginTop: 0, marginBottom: 10 }}>
              Вы уверены, что хотите удалить пользователя {deleteUserModal.userName}?
            </p>
            <p style={{ marginTop: 0, marginBottom: 16, color: "#b91c1c", fontWeight: 700 }}>
              Внимание: вместе с пользователем удалятся все созданные им формы. Если формы нужны - лучше просто отключить пользователя.
            </p>
            <div className="deadline-modal-actions">
              <button onClick={() => setDeleteUserModal(null)}>Отмена</button>
              <button
                onClick={async () => {
                  await deleteUserMutation.mutateAsync(deleteUserModal.userId);
                  setDeleteUserModal(null);
                }}
                disabled={deleteUserMutation.isPending}
              >
                Удалить пользователя
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
