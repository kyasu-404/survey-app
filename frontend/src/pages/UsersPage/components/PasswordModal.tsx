import { useId } from "react";
import { NEW_PASSWORD_MIN_LENGTH } from "../../../shared/lib/passwordPolicy";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
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
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <div
        ref={dialogRef}
        className="modal-card card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!isPending && !passwordError) onChangePassword();
          }}
        >
          <h3 id={titleId} className="users-modal-title">{modal.title}</h3>
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
            <button type="button" className="users-neutral-button" onClick={onCancel} disabled={isPending}>
              Отмена
            </button>
            <button type="submit" className="users-yellow-button" disabled={isPending || Boolean(passwordError)}>
              {isPending && <InlineSpinner />}
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
