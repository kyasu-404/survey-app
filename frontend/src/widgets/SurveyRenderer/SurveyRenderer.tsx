import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
  initialData?: Record<string, unknown>;
  isPreview?: boolean;
};

export function SurveyRenderer({ schema, formId, initialData, isPreview = false }: SurveyRendererProps) {
  return <SurveyFormRenderer schema={schema} formId={formId} initialData={initialData} isPreview={isPreview} />;
}
