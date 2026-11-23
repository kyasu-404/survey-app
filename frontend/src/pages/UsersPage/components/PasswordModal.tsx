import { NEW_PASSWORD_MIN_LENGTH } from "../../../shared/lib/passwordPolicy";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { PasswordModalState } from "../types";

type PasswordModalProps = {
  passwordError: string | null;
  isPending: boolean;
  modal: PasswordModalState;
  onCancel: () => void;
  onChangePassword: () => void;
  onPasswordChange: (password: string) => void;
};

export function PasswordModal({
  passwordError,
  isPending,
  modal,
  onCancel,
  onChangePassword,
  onPasswordChange,
}: PasswordModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card">
        <h3 className="users-modal-title">{modal.title}</h3>
        <label className="deadline-field">
          <span>Новый пароль</span>
          <input
            type="password"
            autoComplete="new-password"
            value={modal.password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder={`Минимум ${NEW_PASSWORD_MIN_LENGTH} символов`}
          />
        </label>
        {passwordError && modal.password.length > 0 && <p className="users-inline-warning">{passwordError}</p>}
        <div className="deadline-modal-actions">
          <button className="users-neutral-button" onClick={onCancel}>
            Отмена
          </button>
          <button className="users-yellow-button" onClick={onChangePassword} disabled={isPending || Boolean(passwordError)}>
            {isPending && <InlineSpinner />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
