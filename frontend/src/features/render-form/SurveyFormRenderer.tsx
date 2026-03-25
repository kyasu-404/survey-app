import { useEffect, useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import type { SurveySchema } from "../../entities/survey/types";
import { submitResponse } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";
import { useToast } from "../../app/providers/ToastProvider";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
};

export function SurveyFormRenderer({ schema, formId }: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();
  const model = useMemo(() => new Model(schema), [schema]);

  useEffect(() => {
    const handleComplete = async (sender: Model) => {
      setIsSubmitting(true);
      try {
        const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
        await submitResponse(payload.formId, payload.answers);
        showToast("Ответ успешно отправлен", "success");
      } catch (error) {
        console.error(error);
        showToast("Не удалось отправить ответ", "error");
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
      <Survey model={model} />
    </>
  );
}
