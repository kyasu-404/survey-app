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
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

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

  const users = usersQuery.data ?? [];
  const activeUsersCount = useMemo(() => users.filter((profile) => !profile.is_disabled).length, [users]);
  const disabledUsersCount = useMemo(() => users.filter((profile) => profile.is_disabled).length, [users]);

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setNewUser({ name: "", email: "", password: "", role: "user" });
      showToast("Пользователь создан", "success");
      scheduleQueryInvalidation(queryClient, "create user", [{ queryKey: ["users"] }]);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось создать пользователя"), "error");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      showToast("Пользователь удалён", "success");
      scheduleQueryInvalidation(queryClient, "delete user", [{ queryKey: ["users"] }]);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось удалить пользователя"), "error");
    },
  });

  const setUserDisabledMutation = useMutation({
    mutationFn: ({ userId, disabled }: { userId: string; disabled: boolean }) => setUserDisabled(userId, disabled),
    onSuccess: (_data, variables) => {
      showToast(variables.disabled ? "Пользователь отключён" : "Пользователь включён", "success");
      scheduleQueryInvalidation(queryClient, "toggle user disabled", [{ queryKey: ["users"] }]);
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
    <div className="dashboard-page dashboard-shell users-page-shell">
      <section className="card dashboard-hero command-center-hero users-page-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker">Администрирование</span>
          <h1 className="dashboard-title">Пользователи</h1>
          <p className="dashboard-subtitle">
            Создавайте аккаунты, меняйте пароли и управляйте доступом из одного рабочего центра без лишних переходов.
          </p>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat-card">
            <span>Всего пользователей</span>
            <strong>{users.length}</strong>
          </div>
          <div className="dashboard-stat-card">
            <span>Активные</span>
            <strong>{activeUsersCount}</strong>
          </div>
          <div className="dashboard-stat-card">
            <span>Отключены</span>
            <strong>{disabledUsersCount}</strong>
          </div>
        </div>
      </section>

      <div className="command-center-grid users-page-modules">
        <section className="card dashboard-module users-page-module">
          <div className="dashboard-module-header users-page-module-header">
            <div>
              <h2>Создание пользователя</h2>
              <p className="users-page-module-note">
                Добавьте имя, email, роль и пароль. После создания список автоматически обновится.
              </p>
            </div>
            <span>{isPasswordValid ? "Готово к созданию" : "Пароль от 8 символов"}</span>
          </div>

          <div className="users-page-form-grid">
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

          <div className="users-page-actions">
            <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>
              Создать пользователя
            </button>
            <button onClick={() => openPasswordModal(user?.id ?? "", "Смена моего пароля", true)} disabled={!user}>
              Сменить мой пароль
            </button>
          </div>

          {!isPasswordValid && newUser.password.length > 0 && (
            <p className="users-page-hint">Пароль должен быть не короче 8 символов</p>
          )}
        </section>

        <section className="card dashboard-module users-page-module">
          <div className="dashboard-module-header users-page-module-header">
            <div>
              <h2>Список пользователей</h2>
              <p className="users-page-module-note">Тут отображаются статусы, действия и дата создания каждого аккаунта.</p>
            </div>
            <span>{users.length}</span>
          </div>

          {isAuthLoading || usersQuery.isLoading ? (
            <p className="dashboard-loading-text">Загрузка пользователей...</p>
          ) : !user ? (
            <div className="dashboard-empty-state">
              <h4>Требуется авторизация</h4>
              <p>Войдите в систему, чтобы просматривать и управлять пользователями.</p>
            </div>
          ) : usersQuery.isError ? (
            <div className="dashboard-empty-state">
              <h4>Не удалось загрузить пользователей</h4>
              <p>{getErrorMessage(usersQuery.error, "Попробуйте повторить запрос")}</p>
              <button onClick={() => void usersQuery.refetch()}>Повторить</button>
            </div>
          ) : (
            <div className="users-page-table-wrapper">
              <table className="responses-table users-page-table">
                <thead>
                  <tr>
                    <th scope="col">Имя</th>
                    <th scope="col">Email</th>
                    <th scope="col">Роль</th>
                    <th scope="col">Статус</th>
                    <th scope="col">Создан</th>
                    <th scope="col">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((profile) => {
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
                          <div className="users-page-row-actions">
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
            </div>
          )}
        </section>
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
              <button
                onClick={() => void onChangePassword()}
                disabled={updatePasswordMutation.isPending || updateUserPasswordMutation.isPending || !isModalPasswordValid}
              >
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
              Внимание: вместе с пользователем удалятся все созданные им формы. Если формы нужны - лучше просто отключить
              пользователя.
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
