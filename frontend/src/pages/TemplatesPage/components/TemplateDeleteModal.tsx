import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { useId } from "react";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type TemplateDeleteModalProps = {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  template: SurveyFormSummary;
};

export function TemplateDeleteModal({ isPending, onCancel, onConfirm, template }: TemplateDeleteModalProps) {
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <div
        ref={dialogRef}
        className="modal-card card dashboard-delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeading onClose={onCancel} disabled={isPending} lightOnly>
          <h3 id={titleId} className="dashboard-delete-modal-title">Удаление шаблона</h3>
        </ModalHeading>
        <p className="dashboard-delete-modal-copy">Удалить шаблон «{template.title}»? Это действие нельзя отменить.</p>
        <div className="dashboard-delete-modal-actions">
          <button type="button" className="app-button" onClick={onCancel} disabled={isPending}>
            Отмена
          </button>
          <button type="button" className="dashboard-danger-button" onClick={onConfirm} disabled={isPending}>
            {isPending && <InlineSpinner />}
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
}
