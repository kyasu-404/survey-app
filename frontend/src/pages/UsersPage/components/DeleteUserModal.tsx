import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { DeleteUserModalState } from "../types";

type DeleteUserModalProps = {
  isPending: boolean;
  modal: DeleteUserModalState;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteUserModal({ isPending, modal, onCancel, onConfirm }: DeleteUserModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card">
        <h3 className="users-modal-title">Удаление пользователя</h3>
        <p className="users-modal-copy">Вы уверены, что хотите удалить пользователя {modal.userName}?</p>
        <p className="users-modal-copy users-modal-copy-danger">
          Внимание: вместе с пользователем удалятся все созданные им формы. Если формы нужны - лучше просто отключить пользователя.
        </p>
        <div className="deadline-modal-actions">
          <button className="users-neutral-button" onClick={onCancel}>
            Отмена
          </button>
          <button className="users-danger-button" onClick={onConfirm} disabled={isPending}>
            {isPending && <InlineSpinner />}
            Удалить пользователя
          </button>
        </div>
      </div>
    </div>
  );
}
