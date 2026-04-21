import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer, type SurveyRenderMode } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
  respondentId?: string;
  initialData?: Record<string, unknown>;
  initialPageNo?: number;
  renderMode?: SurveyRenderMode;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
};

export function SurveyRenderer({
  schema,
  formId,
  respondentId,
  initialData,
  initialPageNo,
  renderMode,
  isPreview = false,
  allowAnonymousUploads = false,
}: SurveyRendererProps) {
  return (
    <SurveyFormRenderer
      schema={schema}
      formId={formId}
      respondentId={respondentId}
      initialData={initialData}
      initialPageNo={initialPageNo}
      renderMode={renderMode}
      isPreview={isPreview}
      allowAnonymousUploads={allowAnonymousUploads}
    />
  );
}
