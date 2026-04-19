import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { SurveyRenderer } from "../../../widgets/SurveyRenderer/SurveyRenderer";
import type { SurveyForm, SurveyFormSummary } from "../../../entities/survey/types";

type TemplatePreviewModalProps = {
  isLoading: boolean;
  onClose: () => void;
  previewTemplate?: SurveyForm;
  previewTemplateCard: SurveyFormSummary;
};

export function TemplatePreviewModal({ isLoading, onClose, previewTemplate, previewTemplateCard }: TemplatePreviewModalProps) {
  return (
    <div className="template-preview-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="template-preview-drawer" role="dialog" aria-label={`Превью шаблона ${previewTemplateCard.title}`} aria-modal="true">
        <div className="template-preview-header">
          <div>
            <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
          </div>
          <button type="button" className="template-preview-close" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="template-preview-body survey-page-card">
          {isLoading && (
            <div className="dashboard-forms-loading" role="status" aria-live="polite">
              <span>Загрузка шаблона</span>
              <InlineSpinner />
            </div>
          )}

          {previewTemplate && (
            <SurveyRenderer
              schema={{
                ...previewTemplate.schema,
                title: previewTemplate.title,
              }}
              formId={previewTemplate.id}
              isPreview
            />
          )}
        </div>
      </aside>
    </div>
  );
}
