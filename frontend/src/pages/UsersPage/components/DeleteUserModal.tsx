import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { useId } from "react";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
import type { DeleteUserModalState } from "../types";

type DeleteUserModalProps = {
  isPending: boolean;
  modal: DeleteUserModalState;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteUserModal({ isPending, modal, onCancel, onConfirm }: DeleteUserModalProps) {
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <div
        ref={dialogRef}
        className="modal-card card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeading onClose={onCancel} disabled={isPending} lightOnly>
          <h3 id={titleId} className="users-modal-title">Удаление пользователя</h3>
        </ModalHeading>
        <p className="users-modal-copy">Вы уверены, что хотите удалить пользователя {modal.userName}?</p>
        <p className="users-modal-copy users-modal-copy-danger">
          Внимание: вместе с пользователем удалятся все созданные им формы. Если формы нужны - лучше просто отключить пользователя.
        </p>
        <div className="deadline-modal-actions">
          <button type="button" className="users-neutral-button" onClick={onCancel} disabled={isPending}>
            Отмена
          </button>
          <button type="button" className="users-danger-button" onClick={onConfirm} disabled={isPending}>
            {isPending && <InlineSpinner />}
            Удалить пользователя
          </button>
        </div>
      </div>
    </div>
  );
}
