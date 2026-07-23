import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type TemplateDeleteModalProps = {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  template: SurveyFormSummary;
};

export function TemplateDeleteModal({ isPending, onCancel, onConfirm, template }: TemplateDeleteModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card dashboard-delete-modal">
        <h3 className="dashboard-delete-modal-title">Удаление шаблона</h3>
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
