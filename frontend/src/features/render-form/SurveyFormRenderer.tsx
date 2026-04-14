import { useEffect, useMemo, useRef, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { resolveDefaultSurveyLogo } from "../../entities/survey/model/defaultSurveyLogo";
import { registerCustomSurveyQuestionTypes } from "../../entities/survey/model/surveyQuestionTypes";
import type { SurveySchema } from "../../entities/survey/types";
import { useSubmitResponseMutation } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";
import { useToast } from "../../app/providers/ToastProvider";
import { getSubmitResponseErrorMessage } from "../../shared/lib/error";
import {
  getStoragePathFromSurveyFileValue,
  removeFileFromStorage,
  resolveSurveyFileValueContent,
  uploadFileToStorage,
} from "../../shared/api/storage";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
  initialData?: Record<string, unknown>;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
};

function normalizeSurveyFileQuestions(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSurveyFileQuestions(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const normalizedObject = Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, normalizeSurveyFileQuestions(nestedValue)]),
  );

  if (normalizedObject.type === "file") {
    return {
      ...normalizedObject,
      storeDataAsText: false,
      waitForUpload: true,
    };
  }

  return normalizedObject;
}

export function SurveyFormRenderer({
  schema,
  formId,
  initialData,
  isPreview = false,
  allowAnonymousUploads = false,
}: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { showToast } = useToast();
  const submitResponseMutation = useSubmitResponseMutation();
  const allowProgrammaticCompleteRef = useRef(false);
  const model = useMemo(() => {
    registerCustomSurveyQuestionTypes();
    const resolvedSchema = normalizeSurveyFileQuestions(resolveDefaultSurveyLogo(schema)) as SurveySchema;
    const nextModel = new Model(resolvedSchema);
    nextModel.locale = resolvedSchema.locale ?? "ru";
    nextModel.completeText = "Отправить";
    nextModel.completedHtml = "<div class='survey-complete-message'>Спасибо за Ваш ответ!</div>";
    if (initialData) {
      nextModel.data = initialData;
    }
    if (isPreview) {
      nextModel.readOnly = true;
      nextModel.showCompleteButton = false;
      nextModel.showNavigationButtons = false;
    }
    return nextModel;
  }, [initialData, isPreview, schema]);

  useEffect(() => {
    const handleDownloadFile = async (
      _sender: Model,
      options: { fileValue?: unknown; callback: (status: "success" | "error", data: unknown) => void }
    ) => {
      try {
        const fileContent = await resolveSurveyFileValueContent(options.fileValue);
        options.callback("success", fileContent);
      } catch (error) {
        console.error(error);
        options.callback("error", getSubmitResponseErrorMessage(error));
      }
    };

    model.onDownloadFile.add(handleDownloadFile);

    if (isPreview) {
      return () => {
        model.onDownloadFile.remove(handleDownloadFile);
      };
    }

    const handleUploadFiles = async (
      _sender: Model,
      options: { files: File[]; callback: (data: unknown, errors?: unknown) => void }
    ) => {
      try {
        const uploaded = await Promise.all(
          options.files.map((file) => uploadFileToStorage(formId, file, { allowAnonymous: allowAnonymousUploads })),
        );

        options.callback(
          uploaded.map((item) => ({
            file: item.file,
            content: item.path,
          })),
        );
      } catch (error) {
        console.error(error);
        showToast(getSubmitResponseErrorMessage(error), "error");
        options.callback([], ["Не удалось загрузить файл"]);
      }
    };

    const handleClearFiles = async (
      _sender: Model,
      options: { value: unknown; callback: (status: "success" | "error") => void }
    ) => {
      try {
        const values = Array.isArray(options.value) ? options.value : [options.value];
        const paths = values
          .map((value) => getStoragePathFromSurveyFileValue(value))
          .filter((path): path is string => Boolean(path));

        if (paths.length > 0) {
          await Promise.all(
            paths.map((path) => removeFileFromStorage(path, { allowAnonymous: allowAnonymousUploads, formId })),
          );
        }

        options.callback("success");
      } catch (error) {
        console.error(error);
        options.callback("error");
      }
    };

    const handleCompleting = async (
      sender: Model,
      options: { allowComplete?: boolean; allow?: boolean }
    ) => {
      if (allowProgrammaticCompleteRef.current) {
        allowProgrammaticCompleteRef.current = false;
        return;
      }

      options.allowComplete = false;
      options.allow = false;
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);
        await submitResponseMutation.mutateAsync({ formId: payload.formId, data: payload.answers });
        allowProgrammaticCompleteRef.current = true;
        sender.doComplete();
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
    model.onCompleting.add(handleCompleting);

    return () => {
      model.onUploadFiles.remove(handleUploadFiles);
      model.onDownloadFile.remove(handleDownloadFile);
      model.onClearFiles.remove(handleClearFiles);
      model.onCompleting.remove(handleCompleting);
    };
  }, [allowAnonymousUploads, formId, isPreview, model, showToast, submitResponseMutation]);

  return (
    <div className={isSubmitting ? "survey-renderer survey-renderer-submitting" : "survey-renderer"}>
      {submitError && <p style={{ color: "#991b1b", marginBottom: 10 }}>Ошибка отправки: {submitError}</p>}
      <Survey model={model} />
    </div>
  );
}
