import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { useId, useRef, type Dispatch, type SetStateAction } from "react";
import type { UserRole } from "../../../entities/user/types";
import { NEW_PASSWORD_MIN_LENGTH } from "../../../shared/lib/passwordPolicy";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useModalSurface } from "../../../shared/ui/useModalSurface";
import type { NewUserForm } from "../types";

type CreateUserFormProps = {
  isCreatePending: boolean;
  passwordError: string | null;
  newUser: NewUserForm;
  onCreateUser: () => void;
  onCancel: () => void;
  setNewUser: Dispatch<SetStateAction<NewUserForm>>;
};

export function CreateUserForm({ isCreatePending, passwordError, newUser, onCreateUser, onCancel, setNewUser }: CreateUserFormProps) {
  const fieldId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const dialog = useModalSurface(nameInput);
  const cancel = () => { if (!isCreatePending) onCancel(); };
  return (
    <dialog ref={dialog} className="modal-card card users-create-modal" aria-labelledby="create-user-title"
      onCancel={event => { event.preventDefault(); cancel(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) cancel();
      }}>
      <ModalHeading onClose={cancel} disabled={isCreatePending}>
        <h2 id="create-user-title">Добавить пользователя</h2>
      </ModalHeading>
      <form method="post" onSubmit={event => { event.preventDefault(); onCreateUser(); }}>
        <div className="users-create-grid">
          <label className="deadline-field" htmlFor={`${fieldId}-name`}>
            <span>Имя</span>
            <input
              id={`${fieldId}-name`}
              name="name"
              ref={nameInput}
              required
              autoComplete="name"
              value={newUser.name}
              onChange={event => setNewUser(prev => ({ ...prev, name: event.target.value }))}
              placeholder="Имя"
            />
          </label>
          <label className="deadline-field" htmlFor={`${fieldId}-email`}>
            <span>Email</span>
            <input
              id={`${fieldId}-email`}
              name="email"
              required
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={newUser.email}
              onChange={event => setNewUser(prev => ({ ...prev, email: event.target.value }))}
              placeholder="Email"
            />
          </label>
          <label className="deadline-field" htmlFor={`${fieldId}-password`}>
            <span>Пароль</span>
            <input
              id={`${fieldId}-password`}
              name="new-password"
              required
              type="password"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={newUser.password}
              onChange={event => setNewUser(prev => ({ ...prev, password: event.target.value }))}
              placeholder={`Минимум ${NEW_PASSWORD_MIN_LENGTH} символов`}
            />
          </label>
          <label className="deadline-field" htmlFor={`${fieldId}-role`}>
            <span>Роль</span>
            <select
              id={`${fieldId}-role`}
              name="role"
              value={newUser.role}
              onChange={event => setNewUser(prev => ({ ...prev, role: event.target.value as UserRole }))}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
        </div>
        {passwordError && newUser.password.length > 0 && <p className="users-inline-warning">{passwordError}</p>}
        <div className="deadline-modal-actions">
          <button type="button" className="users-neutral-button" onClick={cancel} disabled={isCreatePending}>Отмена</button>
          <button type="submit" className="app-button button-primary" disabled={isCreatePending || Boolean(passwordError) || !newUser.name.trim() || !newUser.email.trim()}>{isCreatePending && <InlineSpinner />}Создать пользователя</button>
        </div>
      </form>
    </dialog>
  );
}
