import { useQuery } from "@tanstack/react-query";
import { getAllUsers } from "../../features/users/api";
import { useAuth } from "../../app/providers/AuthProvider";
import { USERS_QUERY_ROOT } from "../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { CreateUserForm } from "./components/CreateUserForm";
import { DeleteUserModal } from "./components/DeleteUserModal";
import { PasswordModal } from "./components/PasswordModal";
import { RoleChangeModal } from "./components/RoleChangeModal";
import { UsersFiltersBar } from "./components/UsersFiltersBar";
import { UsersTable } from "./components/UsersTable";
import { useUsersAdminActions } from "./hooks/useUsersAdminActions";
import { useUsersFilters } from "./hooks/useUsersFilters";

function UsersLoadingState() {
  return (
    <p className="users-page-status" role="status" aria-live="polite">
      <span>Загрузка пользователей</span>
      <InlineSpinner />
    </p>
  );
}

export default function UsersPage() {
  const { user, loading: isAuthLoading } = useAuth();
  const usersQuery = useQuery({
    queryKey: USERS_QUERY_ROOT,
    queryFn: getAllUsers,
    enabled: !isAuthLoading && Boolean(user),
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const users = usersQuery.data ?? [];
  const filters = useUsersFilters(users);
  const actions = useUsersAdminActions();

  return (
    <div className="dashboard-page">
      <div className="card users-page-card">
        <h2 className="users-page-title">Пользователи</h2>

        <CreateUserForm
          canChangeOwnPassword={Boolean(user)}
          isCreatePending={actions.createUserPending}
          isPasswordValid={actions.isPasswordValid}
          newUser={actions.newUser}
          onCreateUser={() => void actions.onCreateUser()}
          onOpenOwnPasswordModal={() => actions.openPasswordModal(user?.id ?? "", "Смена моего пароля", true)}
          setNewUser={actions.setNewUser}
        />

        <UsersFiltersBar
          roleFilter={filters.roleFilter}
          search={filters.search}
          setRoleFilter={filters.setRoleFilter}
          setSearch={filters.setSearch}
          setStatusFilter={filters.setStatusFilter}
          statusFilter={filters.statusFilter}
        />

        {isAuthLoading || usersQuery.isLoading ? (
          <UsersLoadingState />
        ) : !user ? (
          <p className="users-page-status users-page-status-warning">Требуется авторизация для просмотра пользователей.</p>
        ) : usersQuery.isError ? (
          <div className="users-page-error">
            <p className="users-page-error-copy">{getErrorMessage(usersQuery.error, "Не удалось загрузить пользователей")}</p>
            <button onClick={() => void usersQuery.refetch()} className="users-page-retry-button">
              Повторить
            </button>
          </div>
        ) : filters.filteredUsers.length === 0 ? (
          <div className="dashboard-empty-state">
            <h4>{users.length === 0 ? "Пользователей пока нет" : "Ничего не найдено"}</h4>
            <p>
              {users.length === 0
                ? "Создайте первого пользователя или проверьте права доступа."
                : "Измените поисковый запрос или фильтры роли и статуса."}
            </p>
          </div>
        ) : (
          <UsersTable
            currentUserId={user.id}
            isDeletePending={actions.deleteUserPending}
            isRoleChangePending={actions.roleChangePending}
            isStatusChangePending={actions.isStatusChangePending}
            onOpenPasswordModal={actions.openPasswordModal}
            onRequestDelete={(userId, userName) => actions.setDeleteUserModal({ userId, userName })}
            onRequestRoleChange={(userId, userName, currentRole, nextRole) =>
              actions.setRoleChangeModal({ userId, userName, currentRole, nextRole })
            }
            onToggleUserDisabled={(userId, disabled) => void actions.onToggleUserDisabled(userId, disabled)}
            pendingStatusUserId={actions.pendingStatusUserId}
            users={filters.filteredUsers}
          />
        )}
      </div>

      {actions.passwordModal && (
        <PasswordModal
          isPasswordValid={actions.isModalPasswordValid}
          isPending={actions.updatePasswordPending}
          modal={actions.passwordModal}
          onCancel={() => actions.setPasswordModal(null)}
          onChangePassword={() => void actions.onChangePassword()}
          onPasswordChange={actions.updatePasswordModalValue}
        />
      )}

      {actions.deleteUserModal && (
        <DeleteUserModal
          isPending={actions.deleteUserPending}
          modal={actions.deleteUserModal}
          onCancel={() => actions.setDeleteUserModal(null)}
          onConfirm={() => void actions.onDeleteUser()}
        />
      )}

      {actions.roleChangeModal && (
        <RoleChangeModal
          isPending={actions.roleChangePending}
          modal={actions.roleChangeModal}
          onCancel={() => actions.setRoleChangeModal(null)}
          onConfirm={() => void actions.onChangeRole()}
        />
      )}
    </div>
  );
}
