import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
import type { RoleChangeModalState } from "../types";

type RoleChangeModalProps = {
  isPending: boolean;
  modal: RoleChangeModalState;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RoleChangeModal({ isPending, modal, onCancel, onConfirm }: RoleChangeModalProps) {
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });
  const accessNotice =
    modal.nextRole === "admin"
      ? "Пользователь получит доступ к административным функциям."
      : "Пользователь потеряет доступ к административным функциям.";

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <div
        ref={dialogRef}
        className="modal-card card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="users-role-change-title"
        aria-describedby="users-role-change-description"
        tabIndex={-1}
      >
        <ModalHeading onClose={onCancel} disabled={isPending} lightOnly>
          <h3 id="users-role-change-title" className="users-modal-title">
            Смена роли пользователя
          </h3>
        </ModalHeading>
        <p id="users-role-change-description" className="users-modal-copy">
          Изменить роль пользователя {modal.userName} с <strong>{modal.currentRole}</strong> на{" "}
          <strong>{modal.nextRole}</strong>?
        </p>
        <p className="users-modal-copy">{accessNotice}</p>
        <div className="deadline-modal-actions">
          <button type="button" className="users-neutral-button" onClick={onCancel} disabled={isPending}>
            Отмена
          </button>
          <button type="button" className="users-yellow-button" onClick={onConfirm} disabled={isPending}>
            {isPending && <InlineSpinner />}
            Сменить роль
          </button>
        </div>
      </div>
    </div>
  );
}
