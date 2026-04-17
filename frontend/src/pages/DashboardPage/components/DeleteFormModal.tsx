import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type DeleteFormModalProps = {
  form: SurveyFormSummary;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteFormModal({ form, isPending, onCancel, onConfirm }: DeleteFormModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card dashboard-delete-modal">
        <h3 className="dashboard-delete-modal-title">Удаление формы</h3>
        <p className="dashboard-delete-modal-copy">Удалить форму «{form.title}»? Это действие нельзя отменить.</p>
        <div className="dashboard-delete-modal-actions">
          <button type="button" onClick={onCancel} disabled={isPending}>
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
