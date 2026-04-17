import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
  respondentId?: string;
  initialData?: Record<string, unknown>;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
};

export function SurveyRenderer({
  schema,
  formId,
  respondentId,
  initialData,
  isPreview = false,
  allowAnonymousUploads = false,
}: SurveyRendererProps) {
  return (
    <SurveyFormRenderer
      schema={schema}
      formId={formId}
      respondentId={respondentId}
      initialData={initialData}
      isPreview={isPreview}
      allowAnonymousUploads={allowAnonymousUploads}
    />
  );
}
