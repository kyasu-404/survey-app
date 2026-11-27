import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { useId, useRef } from "react";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useModalSurface } from "../../../shared/ui/useModalSurface";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type DeleteFormModalProps = {
  form: SurveyFormSummary;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteFormModal({ form, isPending, onCancel, onConfirm }: DeleteFormModalProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  const dialog = useModalSurface(cancel);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <dialog ref={dialog} className="modal-card card dashboard-delete-modal"
      aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); if (!isPending) onCancel(); }}>
      <ModalHeading onClose={onCancel} disabled={isPending}>
        <h3 className="dashboard-delete-modal-title" id={titleId}>Удаление формы</h3>
      </ModalHeading>
      <p className="dashboard-delete-modal-copy" id={descriptionId}>Удалить форму «{form.title}»? Это действие нельзя отменить.</p>
      <div className="dashboard-delete-modal-actions">
        <button ref={cancel} type="button" className="app-button" onClick={onCancel} disabled={isPending}>
          Отмена
        </button>
        <button type="button" className="dashboard-danger-button" onClick={onConfirm} disabled={isPending}>
          {isPending && <InlineSpinner />}
          Удалить
        </button>
      </div>
    </dialog>
  );
}
