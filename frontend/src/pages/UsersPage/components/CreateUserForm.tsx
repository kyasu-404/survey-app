import type { Dispatch, SetStateAction } from "react";
import type { UserRole } from "../../../entities/user/types";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { NewUserForm } from "../types";

type CreateUserFormProps = {
  canChangeOwnPassword: boolean;
  isCreatePending: boolean;
  isPasswordValid: boolean;
  newUser: NewUserForm;
  onCreateUser: () => void;
  onOpenOwnPasswordModal: () => void;
  setNewUser: Dispatch<SetStateAction<NewUserForm>>;
};

export function CreateUserForm({
  canChangeOwnPassword,
  isCreatePending,
  isPasswordValid,
  newUser,
  onCreateUser,
  onOpenOwnPasswordModal,
  setNewUser,
}: CreateUserFormProps) {
  return (
    <div className="users-page-controls">
      <div className="users-create-grid">
        <input value={newUser.name} onChange={(event) => setNewUser((prev) => ({ ...prev, name: event.target.value }))} placeholder="Имя" />
        <input value={newUser.email} onChange={(event) => setNewUser((prev) => ({ ...prev, email: event.target.value }))} placeholder="Email" />
        <input
          type="password"
          value={newUser.password}
          onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="Пароль (минимум 8 символов)"
        />
        <select value={newUser.role} onChange={(event) => setNewUser((prev) => ({ ...prev, role: event.target.value as UserRole }))}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>

      <div className="users-page-toolbar">
        <button className="app-button" onClick={onCreateUser} disabled={isCreatePending || !isPasswordValid}>
          {isCreatePending && <InlineSpinner />}
          Создать пользователя
        </button>
        <button className="users-yellow-button" onClick={onOpenOwnPasswordModal} disabled={!canChangeOwnPassword}>
          Сменить мой пароль
        </button>
        {!isPasswordValid && newUser.password.length > 0 && (
          <span className="users-inline-warning">Пароль должен быть не короче 8 символов</span>
        )}
      </div>
    </div>
  );
}
