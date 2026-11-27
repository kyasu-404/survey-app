import { ModalHeading } from "../../../shared/ui/ModalHeading";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { Suspense } from "react";
import { LazySurveyRenderer } from "../../../widgets/SurveyRenderer/LazySurveyRenderer";
import { SurveyRuntimeSurface } from "../../../widgets/SurveyRenderer/SurveyRuntimeSurface";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
import type { SurveyForm, SurveyFormSummary } from "../../../entities/survey/types";

type TemplatePreviewModalProps = {
  isLoading: boolean;
  onClose: () => void;
  previewTemplate?: SurveyForm;
  previewTemplateCard: SurveyFormSummary;
};

export function TemplatePreviewModal({ isLoading, onClose, previewTemplate, previewTemplateCard }: TemplatePreviewModalProps) {
  const dialogRef = useLegacyModalDialog<HTMLElement>({ onClose });

  return (
    <div className="template-preview-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside
        ref={dialogRef}
        className="template-preview-drawer"
        role="dialog"
        aria-label={`Превью шаблона ${previewTemplateCard.title}`}
        aria-modal="true"
        tabIndex={-1}
      >
        <ModalHeading className="template-preview-header" onClose={onClose} closeClassName="responses-export-button">
          <div>
            <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
          </div>
        </ModalHeading>
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
