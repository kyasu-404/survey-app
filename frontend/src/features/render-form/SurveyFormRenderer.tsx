import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import type { SurveySchema } from "../../entities/survey/types";
import { submitResponse } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
};

export function SurveyFormRenderer({ schema, formId }: SurveyFormRendererProps) {
  const model = new Model(schema);

  model.onComplete.add(async (sender) => {
    const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
    await submitResponse(payload.formId, payload.answers);
  });

  return <Survey model={model} />;
}
