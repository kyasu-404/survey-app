import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
  isPreviewMode?: boolean;
};

export function SurveyRenderer({ schema, formId, isPreviewMode = false }: SurveyRendererProps) {
  return <SurveyFormRenderer schema={schema} formId={formId} isPreviewMode={isPreviewMode} />;
}
