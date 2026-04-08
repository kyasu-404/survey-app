import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  formId: string;
};

export function SurveyRenderer({ schema, formId }: SurveyRendererProps) {
  return <SurveyFormRenderer schema={schema} formId={formId} />;
}
