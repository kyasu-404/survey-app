import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { Suspense } from "react";
import { LazySurveyRenderer } from "../../../widgets/SurveyRenderer/LazySurveyRenderer";
import { SurveyRuntimeSurface } from "../../../widgets/SurveyRenderer/SurveyRuntimeSurface";
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
          <button type="button" className="responses-export-button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <SurveyRuntimeSurface className="template-preview-body">
          {isLoading && (
            <div className="dashboard-forms-loading" role="status" aria-live="polite">
              <span>Загрузка шаблона</span>
              <InlineSpinner />
            </div>
          )}

          {previewTemplate && (
            <Suspense fallback={<InlineSpinner />}>
              <LazySurveyRenderer
                schema={{
                  ...previewTemplate.schema,
                  title: previewTemplate.title,
                }}
                theme={previewTemplate.theme}
                formId={previewTemplate.id}
                renderMode="readonly-navigable"
              />
            </Suspense>
          )}
        </SurveyRuntimeSurface>
      </aside>
    </div>
  );
}
