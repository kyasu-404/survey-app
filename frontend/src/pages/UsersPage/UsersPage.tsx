import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createUser,
  deleteUser,
  getAllUsers,
  setUserDisabled,
  updateUserRole,
  updateMyPassword,
  updateUserPassword,
} from "../../features/users/api";
import { useToast } from "../../app/providers/ToastProvider";
import { getErrorMessage } from "../../shared/lib/error";
import { useAuth } from "../../app/providers/AuthProvider";
import type { UserProfile, UserRole } from "../../entities/user/types";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import searchIcon from "../../img/search.svg";

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

type UsersRoleFilter = UserRole | "all";
type UsersStatusFilter = "all" | "active" | "disabled";

function getUserDisplayName(profile: UserProfile) {
  return profile.name || profile.email;
}

function getStatusLabel(profile: UserProfile) {
  return profile.is_disabled ? "Отключён" : "Активен";
}

export default function UsersPage() {
  const { showToast } = useToast();
  const { user, loading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UsersRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<UsersStatusFilter>("all");
  const [newUser, setNewUser] = useState<NewUserForm>({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [editingRoleUserId, setEditingRoleUserId] = useState<string | null>(null);
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [pendingStatusUserId, setPendingStatusUserId] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [deleteUserModal, setDeleteUserModal] = useState<DeleteUserModalState | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: getAllUsers,
    enabled: !isAuthLoading && Boolean(user),
  });

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
    onMutate: ({ userId }) => {
      setPendingStatusUserId(userId);
    },
    onSuccess: (_data, variables) => {
      showToast(variables.disabled ? "Пользователь отключён" : "Пользователь включён", "success");
      scheduleQueryInvalidation(queryClient, "toggle user disabled", [{ queryKey: ["users"] }]);
    },
    onSettled: () => {
      setPendingStatusUserId(null);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось изменить статус пользователя"), "error");
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) => updateUserRole(userId, role),
    onMutate: ({ userId }) => {
      setPendingRoleUserId(userId);
    },
    onSuccess: () => {
      setEditingRoleUserId(null);
      showToast("Роль пользователя обновлена", "success");
      scheduleQueryInvalidation(queryClient, "update user role", [{ queryKey: ["users"] }]);
    },
    onSettled: () => {
      setPendingRoleUserId(null);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось изменить роль пользователя"), "error");
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
  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (usersQuery.data ?? []).filter((profile) => {
      const matchesSearch = normalizedSearch
        ? (profile.name ?? "").toLowerCase().includes(normalizedSearch)
        : true;
      const matchesRole = roleFilter === "all" ? true : profile.role === roleFilter;
      const matchesStatus =
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? !profile.is_disabled
            : profile.is_disabled;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, usersQuery.data]);

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

  const onChangeRole = (profile: UserProfile, role: UserRole) => {
    if (profile.id === user?.id || profile.role === role) {
      setEditingRoleUserId(null);
      return;
    }

    updateUserRoleMutation.mutate({
      userId: profile.id,
      role,
    });
  };

  const renderUsersLoadingState = () => (
    <p className="users-page-status" role="status" aria-live="polite">
      <span>Загрузка пользователей</span>
      <InlineSpinner />
    </p>
  );

  return (
    <div className="dashboard-page">
      <div className="card users-page-card">
        <h2 className="users-page-title">Пользователи</h2>

        <div className="users-page-controls">
          <div className="users-create-grid">
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

          <div className="users-page-toolbar">
            <button onClick={() => void onCreateUser()} disabled={createUserMutation.isPending || !isPasswordValid}>
              {createUserMutation.isPending && <InlineSpinner />}
              Создать пользователя
            </button>
            <button onClick={() => openPasswordModal(user?.id ?? "", "Смена моего пароля", true)} disabled={!user}>
              Сменить мой пароль
            </button>
            {!isPasswordValid && newUser.password.length > 0 && (
              <span className="users-inline-warning">Пароль должен быть не короче 8 символов</span>
            )}
          </div>
        </div>

        <div className="users-filters-grid">
          <label className="users-filter-field users-search-field">
            <div className="users-search-input-shell">
              <img src={searchIcon} alt="" aria-hidden="true" className="users-search-icon" />
              <input
                type="search"
                aria-label="Поиск по имени"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Введите имя для поиска"
              />
            </div>
          </label>
          <label className="users-filter-field">
            <span>Роль</span>
            <select aria-label="Фильтр по роли" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UsersRoleFilter)}>
              <option value="all">Все роли</option>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="users-filter-field">
            <span>Статус</span>
            <select aria-label="Фильтр по статусу" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as UsersStatusFilter)}>
              <option value="all">Все статусы</option>
              <option value="active">Активен</option>
              <option value="disabled">Отключён</option>
            </select>
          </label>
        </div>

        {isAuthLoading || usersQuery.isLoading ? (
          renderUsersLoadingState()
        ) : !user ? (
          <p className="users-page-status users-page-status-warning">Требуется авторизация для просмотра пользователей.</p>
        ) : usersQuery.isError ? (
          <div className="users-page-error">
            <p className="users-page-error-copy">{getErrorMessage(usersQuery.error, "Не удалось загрузить пользователей")}</p>
            <button onClick={() => void usersQuery.refetch()} className="users-page-retry-button">
              Повторить
            </button>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="dashboard-empty-state">
            <h4>{(usersQuery.data ?? []).length === 0 ? "Пользователей пока нет" : "Ничего не найдено"}</h4>
            <p>
              {(usersQuery.data ?? []).length === 0
                ? "Создайте первого пользователя или проверьте права доступа."
                : "Измените поисковый запрос или фильтры роли и статуса."}
            </p>
          </div>
        ) : (
          <div className="users-table-shell">
            <table className="responses-table users-table">
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
                {filteredUsers.map((profile) => {
                  const isOwnUser = profile.id === user?.id;
                  const displayName = getUserDisplayName(profile);
                  const isRolePending = pendingRoleUserId === profile.id;
                  const isStatusPending = pendingStatusUserId === profile.id;

                  return (
                    <tr key={profile.id}>
                      <td>{profile.name || "—"}</td>
                      <td>{profile.email}</td>
                      <td>
                        {isOwnUser ? (
                          <span className="users-role-chip users-role-chip-static">{profile.role}</span>
                        ) : editingRoleUserId === profile.id ? (
                          <select
                            aria-label={`Изменить роль пользователя ${displayName}`}
                            className="users-role-select"
                            value={profile.role}
                            onChange={(event) => onChangeRole(profile, event.target.value as UserRole)}
                            onBlur={() => {
                              if (!isRolePending) {
                                setEditingRoleUserId(null);
                              }
                            }}
                            disabled={isRolePending}
                            autoFocus
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <button
                            type="button"
                            className="users-role-button"
                            aria-label={`Роль пользователя ${displayName}: ${profile.role}`}
                            onClick={() => setEditingRoleUserId(profile.id)}
                            disabled={isRolePending}
                          >
                            {isRolePending && <InlineSpinner />}
                            {profile.role}
                          </button>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`users-status-button ${profile.is_disabled ? "user-status-disabled" : "user-status-active"}`.trim()}
                          aria-label={`Статус пользователя ${displayName}: ${getStatusLabel(profile)}`}
                          onClick={() =>
                            void setUserDisabledMutation.mutateAsync({
                              userId: profile.id,
                              disabled: !profile.is_disabled,
                            })
                          }
                          disabled={setUserDisabledMutation.isPending || isOwnUser}
                        >
                          {isStatusPending && <InlineSpinner />}
                          {getStatusLabel(profile)}
                        </button>
                      </td>
                      <td>{profile.created_at ? new Date(profile.created_at).toLocaleString("ru-RU") : "—"}</td>
                      <td>
                        <div className="users-table-actions">
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
      </div>

      {passwordModal && (
        <div className="modal-backdrop">
          <div className="modal-card card">
            <h3 className="users-modal-title">{passwordModal.title}</h3>
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
                {(updatePasswordMutation.isPending || updateUserPasswordMutation.isPending) && <InlineSpinner />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteUserModal && (
        <div className="modal-backdrop">
          <div className="modal-card card">
            <h3 className="users-modal-title">Удаление пользователя</h3>
            <p className="users-modal-copy">
              Вы уверены, что хотите удалить пользователя {deleteUserModal.userName}?
            </p>
            <p className="users-modal-copy users-modal-copy-danger">
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
                {deleteUserMutation.isPending && <InlineSpinner />}
                Удалить пользователя
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
