import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { PasswordModalState } from "../types";

type PasswordModalProps = {
  isPasswordValid: boolean;
  isPending: boolean;
  modal: PasswordModalState;
  onCancel: () => void;
  onChangePassword: () => void;
  onPasswordChange: (password: string) => void;
};

export function PasswordModal({
  isPasswordValid,
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
            value={modal.password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Минимум 8 символов"
          />
        </label>
        <div className="deadline-modal-actions">
          <button className="users-neutral-button" onClick={onCancel}>
            Отмена
          </button>
          <button className="users-yellow-button" onClick={onChangePassword} disabled={isPending || !isPasswordValid}>
            {isPending && <InlineSpinner />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
