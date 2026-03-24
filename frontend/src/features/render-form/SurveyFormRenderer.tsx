import { useEffect, useMemo } from "react";
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
  const model = useMemo(() => new Model(schema), [schema]);

  useEffect(() => {
    const handleComplete = async (sender: Model) => {
      const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
      await submitResponse(payload.formId, payload.answers);
    };

    model.onComplete.add(handleComplete);

    return () => {
      model.onComplete.remove(handleComplete);
    };
  }, [formId, model]);

  return <Survey model={model} />;
}
