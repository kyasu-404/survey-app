import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
  isPreview?: boolean;
};

export function SurveyRenderer({ schema, formId, isPreview = false }: SurveyRendererProps) {
  return <SurveyFormRenderer schema={schema} formId={formId} isPreview={isPreview} />;
}
