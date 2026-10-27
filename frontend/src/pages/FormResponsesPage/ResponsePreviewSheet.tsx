import { Suspense } from "react";
import type { SurveyForm } from "../../entities/survey/types";
import type { SurveyResponse } from "../../entities/response/types";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { Skeleton } from "../../shared/ui/Skeleton";
import { LazySurveyRenderer } from "../../widgets/SurveyRenderer/LazySurveyRenderer";
import { SurveyRuntimeSurface } from "../../widgets/SurveyRenderer/SurveyRuntimeSurface";

export function ResponsePreviewSheet({ form, response, label, initialPageNo, onClose }: {
  form: SurveyForm; response: SurveyResponse; label: string; initialPageNo?: number; onClose: () => void;
}) {
  const dialog = useModalSurface();
  return <dialog ref={dialog} className="response-preview-drawer" aria-label={label}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const r = event.currentTarget.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right) onClose();
    }}>
    <div className="response-preview-header">
      <span className="dashboard-status-pill dashboard-status-pill-active">Ответ</span>
      <button type="button" className="responses-export-button" onClick={onClose}>Закрыть</button>
    </div>
    <SurveyRuntimeSurface className="response-preview-body response-preview-builder-palette">
      <Suspense fallback={<Skeleton className="response-preview-renderer-skeleton" />}>
        <LazySurveyRenderer schema={{ ...form.schema, title: form.title }} theme={form.theme} formId={form.id}
          initialData={response.data} initialPageNo={initialPageNo} renderMode="readonly-navigable" />
      </Suspense>
    </SurveyRuntimeSurface>
  </dialog>;
}
