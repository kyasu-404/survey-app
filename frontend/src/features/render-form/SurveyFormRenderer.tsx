import { useEffect, useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import type { SurveySchema } from "../../entities/survey/types";
import { submitResponse } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";
import { useToast } from "../../app/providers/ToastProvider";
import { getSubmitResponseErrorMessage } from "../../shared/lib/error";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
};

export function SurveyFormRenderer({ schema, formId }: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { showToast } = useToast();
  const model = useMemo(() => new Model(schema), [schema]);

  useEffect(() => {
    const handleComplete = async (sender: Model) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
        await submitResponse(payload.formId, payload.answers);
        showToast("Ответ успешно отправлен", "success");
      } catch (error) {
        console.error(error);

        const errorMessage = getSubmitResponseErrorMessage(error);
        setSubmitError(errorMessage);
        showToast(errorMessage, "error");
      } finally {
        setIsSubmitting(false);
      }
    };

    model.onComplete.add(handleComplete);

    return () => {
      model.onComplete.remove(handleComplete);
    };
  }, [formId, model, showToast]);

  return (
    <>
      {isSubmitting && <p>Отправка ответа...</p>}
      {submitError && <p style={{ color: "#991b1b", marginBottom: 10 }}>Ошибка отправки: {submitError}</p>}
      <Survey model={model} />
    </>
  );
}
