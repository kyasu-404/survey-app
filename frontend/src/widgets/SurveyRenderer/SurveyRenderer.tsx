import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { submitResponse } from "../../features/submit-response/useSubmitResponse";
import type { SurveySchema } from "../../entities/survey/types";

export function SurveyRenderer({ schema, formId }: { schema: SurveySchema; formId: string }) {
  const model = new Model(schema);

  model.onComplete.add(async (sender) => {
    await submitResponse(formId, sender.data as Record<string, unknown>);
  });

  return <Survey model={model} />;
}
