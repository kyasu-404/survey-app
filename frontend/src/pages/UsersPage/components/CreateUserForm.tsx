import type { Dispatch, SetStateAction } from "react";
import type { UserRole } from "../../../entities/user/types";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useModalSurface } from "../../../shared/ui/useModalSurface";
import type { NewUserForm } from "../types";

type CreateUserFormProps = {
  isCreatePending: boolean;
  isPasswordValid: boolean;
  newUser: NewUserForm;
  onCreateUser: () => void;
  onCancel: () => void;
  setNewUser: Dispatch<SetStateAction<NewUserForm>>;
};

export function CreateUserForm({ isCreatePending, isPasswordValid, newUser, onCreateUser, onCancel, setNewUser }: CreateUserFormProps) {
  const dialog = useModalSurface();
  const cancel = () => { if (!isCreatePending) onCancel(); };
  return (
    <dialog ref={dialog} className="modal-card card users-create-modal" aria-labelledby="create-user-title"
      onCancel={event => { event.preventDefault(); cancel(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) cancel();
      }}>
      <h2 id="create-user-title">Добавить пользователя</h2>
      <form onSubmit={event => { event.preventDefault(); onCreateUser(); }}>
        <div className="users-create-grid">
          <label className="deadline-field"><span>Имя</span><input required autoComplete="name" value={newUser.name} onChange={event => setNewUser(prev => ({ ...prev, name: event.target.value }))} placeholder="Имя" /></label>
          <label className="deadline-field"><span>Email</span><input required type="email" autoComplete="email" value={newUser.email} onChange={event => setNewUser(prev => ({ ...prev, email: event.target.value }))} placeholder="Email" /></label>
          <label className="deadline-field"><span>Пароль</span><input required type="password" minLength={8} autoComplete="new-password" value={newUser.password} onChange={event => setNewUser(prev => ({ ...prev, password: event.target.value }))} placeholder="Минимум 8 символов" /></label>
          <label className="deadline-field"><span>Роль</span><select value={newUser.role} onChange={event => setNewUser(prev => ({ ...prev, role: event.target.value as UserRole }))}><option value="user">user</option><option value="admin">admin</option></select></label>
        </div>
        {!isPasswordValid && newUser.password.length > 0 && <p className="users-inline-warning">Пароль должен быть не короче 8 символов</p>}
        <div className="deadline-modal-actions">
          <button type="button" className="users-neutral-button" onClick={cancel} disabled={isCreatePending}>Отмена</button>
          <button type="submit" className="app-button button-primary" disabled={isCreatePending || !isPasswordValid || !newUser.name.trim() || !newUser.email.trim()}>{isCreatePending && <InlineSpinner />}Создать пользователя</button>
        </div>
      </form>
    </dialog>
  );
}
