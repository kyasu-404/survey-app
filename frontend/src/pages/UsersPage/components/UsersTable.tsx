import type { UserProfile } from "../../../entities/user/types";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { getStatusLabel, getUserDisplayName } from "../usersPageUtils";

type UsersTableProps = {
  currentUserId?: string;
  isDeletePending: boolean;
  isStatusChangePending: boolean;
  onOpenPasswordModal: (userId: string, title: string, isOwnPassword: boolean) => void;
  onRequestDelete: (userId: string, userName: string) => void;
  onToggleUserDisabled: (userId: string, disabled: boolean) => void;
  pendingStatusUserId: string | null;
  users: UserProfile[];
};

export function UsersTable({
  currentUserId,
  isDeletePending,
  isStatusChangePending,
  onOpenPasswordModal,
  onRequestDelete,
  onToggleUserDisabled,
  pendingStatusUserId,
  users,
}: UsersTableProps) {
  return (
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
          {users.map((profile) => {
            const isOwnUser = profile.id === currentUserId;
            const displayName = getUserDisplayName(profile);
            const isStatusPending = pendingStatusUserId === profile.id;

            return (
              <tr key={profile.id}>
                <td>{profile.name || "—"}</td>
                <td>{profile.email}</td>
                <td>
                  <span className="users-role-chip users-role-chip-static">{profile.role}</span>
                </td>
                <td>
                  <button
                    type="button"
                    className={`users-status-button ${profile.is_disabled ? "user-status-disabled" : "user-status-active"}`.trim()}
                    aria-label={`Статус пользователя ${displayName}: ${getStatusLabel(profile)}`}
                    onClick={() => void onToggleUserDisabled(profile.id, !profile.is_disabled)}
                    disabled={isStatusChangePending || isOwnUser}
                  >
                    {isStatusPending && <InlineSpinner />}
                    {getStatusLabel(profile)}
                  </button>
                </td>
                <td>{profile.created_at ? new Date(profile.created_at).toLocaleString("ru-RU") : "—"}</td>
                <td>
                  <div className="users-table-actions">
                    <button
                      className="users-yellow-button"
                      onClick={() =>
                        onOpenPasswordModal(
                          profile.id,
                          isOwnUser ? "Смена моего пароля" : `Смена пароля: ${profile.name || profile.email}`,
                          isOwnUser,
                        )
                      }
                    >
                      Сменить пароль
                    </button>
                    <button
                      className="users-danger-button"
                      onClick={() => onRequestDelete(profile.id, profile.name || profile.email)}
                      disabled={isDeletePending || isOwnUser}
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
  );
}
