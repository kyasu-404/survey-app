import { ModalHeading } from "../../../shared/ui/ModalHeading";
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
  const passwordId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });
  const targetEmail = modal.email.trim();

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
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isPending && !passwordError) onChangePassword();
          }}
        >
          <ModalHeading onClose={onCancel} disabled={isPending}>
            <h3 id={titleId} className="users-modal-title">{modal.title}</h3>
          </ModalHeading>
          {targetEmail && (
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={targetEmail}
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
          )}
          <label className="deadline-field" htmlFor={passwordId}>
            <span>Новый пароль</span>
            <input
              id={passwordId}
              name="new-password"
              type="password"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
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
