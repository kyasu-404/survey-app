import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";

export function SurveyRenderer({ schema, formId }: { schema: SurveySchema; formId: string }) {
  return <SurveyFormRenderer schema={schema} formId={formId} />;
}
