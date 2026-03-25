import { useEffect, useMemo, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import type { SurveySchema } from "../../entities/survey/types";
import { useSubmitResponseMutation } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";
import { useToast } from "../../app/providers/ToastProvider";
import { getSubmitResponseErrorMessage } from "../../shared/lib/error";
import { removeFileFromStorage, uploadFileToStorage } from "../../shared/api/storage";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
};

function getStoragePathByUrl(url: string) {
  const marker = "/object/public/";
  const markerIndex = url.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const pathWithBucket = url.slice(markerIndex + marker.length);
  const firstSlash = pathWithBucket.indexOf("/");

  if (firstSlash === -1) {
    return null;
  }

  return decodeURIComponent(pathWithBucket.slice(firstSlash + 1));
}

export function SurveyFormRenderer({ schema, formId }: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { showToast } = useToast();
  const submitResponseMutation = useSubmitResponseMutation();
  const model = useMemo(() => new Model(schema), [schema]);

  useEffect(() => {
    const handleUploadFiles = async (
      _sender: Model,
      options: { files: File[]; callback: (status: "success" | "error", data: unknown) => void }
    ) => {
      try {
        const uploaded = await Promise.all(options.files.map((file) => uploadFileToStorage(formId, file)));

        options.callback(
          "success",
          uploaded.map((item) => ({
            file: item.file,
            content: item.url,
          }))
        );
      } catch (error) {
        console.error(error);
        showToast(getSubmitResponseErrorMessage(error), "error");
        options.callback("error", "Не удалось загрузить файл");
      }
    };

    const handleClearFiles = async (
      _sender: Model,
      options: { value: string | string[]; callback: (status: "success" | "error") => void }
    ) => {
      try {
        const values = Array.isArray(options.value) ? options.value : [options.value];
        const paths = values
          .map((url) => getStoragePathByUrl(url))
          .filter((path): path is string => Boolean(path));

        if (paths.length > 0) {
          await Promise.all(paths.map((path) => removeFileFromStorage(path)));
        }

        options.callback("success");
      } catch (error) {
        console.error(error);
        options.callback("error");
      }
    };

    const handleComplete = async (sender: Model) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
        await submitResponseMutation.mutateAsync({ formId: payload.formId, data: payload.answers });
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

    model.onUploadFiles.add(handleUploadFiles);
    model.onClearFiles.add(handleClearFiles);
    model.onComplete.add(handleComplete);

    return () => {
      model.onUploadFiles.remove(handleUploadFiles);
      model.onClearFiles.remove(handleClearFiles);
      model.onComplete.remove(handleComplete);
    };
  }, [formId, model, showToast, submitResponseMutation]);

  return (
    <>
      {isSubmitting && <p>Отправка ответа...</p>}
      {submitError && <p style={{ color: "#991b1b", marginBottom: 10 }}>Ошибка отправки: {submitError}</p>}
      <Survey model={model} />
    </>
  );
}
