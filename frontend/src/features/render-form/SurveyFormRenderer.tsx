import { useEffect, useMemo, useRef, useState } from "react";
import { Model, type OpenDropdownMenuEvent } from "survey-core";
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
import {
  cleanupExpiredSurveyResponseDrafts,
  clearSurveyResponseDraft,
  getSurveyResponseDraftStorageKey,
  loadSurveyResponseDraft,
  saveSurveyResponseDraft,
} from "./responseDraft";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  formId: string;
  respondentId?: string;
  initialData?: Record<string, unknown>;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
};

type DropdownPopupModel = {
  focusFirstInputSelector?: string;
};

type SurveyEventLike = {
  add: (handler: (sender: Model) => void) => void;
  remove: (handler: (sender: Model) => void) => void;
};

type SurveyModelWithOptionalUIState = Model & {
  onUIStateChanged?: SurveyEventLike;
  uiState?: unknown;
};

const disabledDropdownAutofocusSelector = ".surveyjs-dropdown-autofocus-disabled";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDropdownPopupModel(question: unknown): DropdownPopupModel | undefined {
  if (!question || typeof question !== "object" || !("dropdownListModel" in question)) {
    return undefined;
  }

  const dropdownListModel = (question as { dropdownListModel?: unknown }).dropdownListModel;
  if (!dropdownListModel || typeof dropdownListModel !== "object" || !("popupModel" in dropdownListModel)) {
    return undefined;
  }

  const popupModel = (dropdownListModel as { popupModel?: unknown }).popupModel;
  if (!popupModel || typeof popupModel !== "object" || !("focusFirstInputSelector" in popupModel)) {
    return undefined;
  }

  return popupModel as DropdownPopupModel;
}

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

function getSurveyUIState(model: Model): Record<string, unknown> | undefined {
  const uiState = (model as SurveyModelWithOptionalUIState).uiState;
  return isRecord(uiState) ? uiState : undefined;
}

function restoreSurveyUIState(model: Model, uiState: Record<string, unknown>) {
  const modelWithUIState = model as SurveyModelWithOptionalUIState;
  if ("uiState" in modelWithUIState) {
    modelWithUIState.uiState = uiState;
  }
}

export function SurveyFormRenderer({
  schema,
  formId,
  respondentId,
  initialData,
  isPreview = false,
  allowAnonymousUploads = false,
}: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { showToast } = useToast();
  const submitResponseMutation = useSubmitResponseMutation();
  const allowProgrammaticCompleteRef = useRef(false);
  const responseDraftStorageKey = useMemo(
    () => (isPreview ? null : getSurveyResponseDraftStorageKey(formId, respondentId)),
    [formId, isPreview, respondentId],
  );
  const model = useMemo(() => {
    registerCustomSurveyQuestionTypes();
    const resolvedSchema = normalizeSurveyFileQuestions(resolveDefaultSurveyLogo(schema)) as SurveySchema;
    const nextModel = new Model(resolvedSchema);
    nextModel.fitToContainer = false;
    nextModel.locale = resolvedSchema.locale ?? "ru";
    nextModel.completeText = "Отправить";
    nextModel.completedHtml = "<div class='survey-complete-message'>Спасибо за Ваш ответ!</div>";
    if (initialData) {
      nextModel.data = initialData;
    } else {
      const savedDraft = loadSurveyResponseDraft(responseDraftStorageKey);
      if (savedDraft) {
        nextModel.data = savedDraft.data;
        if (typeof savedDraft.currentPageNo === "number") {
          nextModel.currentPageNo = savedDraft.currentPageNo;
        }
        if (savedDraft.uiState) {
          restoreSurveyUIState(nextModel, savedDraft.uiState);
        }
      }
    }
    if (isPreview) {
      nextModel.readOnly = true;
      nextModel.showCompleteButton = false;
      nextModel.showNavigationButtons = false;
    }
    return nextModel;
  }, [initialData, isPreview, responseDraftStorageKey, schema]);

  useEffect(() => {
    const handleOpenDropdownMenu = (_sender: Model, options: OpenDropdownMenuEvent) => {
      if (options.deviceType === "desktop") {
        options.menuType = "dropdown";
        const popupModel = getDropdownPopupModel(options.question);
        if (popupModel) {
          popupModel.focusFirstInputSelector = disabledDropdownAutofocusSelector;
        }
      }
    };

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

    model.onOpenDropdownMenu.add(handleOpenDropdownMenu);
    model.onDownloadFile.add(handleDownloadFile);

    if (isPreview) {
      return () => {
        model.onOpenDropdownMenu.remove(handleOpenDropdownMenu);
        model.onDownloadFile.remove(handleDownloadFile);
      };
    }

    cleanupExpiredSurveyResponseDrafts();

    const saveCurrentDraft = (sender: Model) => {
      saveSurveyResponseDraft(responseDraftStorageKey, {
        data: sender.data as Record<string, unknown>,
        uiState: getSurveyUIState(sender),
        currentPageNo: sender.currentPageNo,
      });
    };
    const uiStateChangedEvent = (model as SurveyModelWithOptionalUIState).onUIStateChanged;

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
        clearSurveyResponseDraft(responseDraftStorageKey);
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

    model.onValueChanged.add(saveCurrentDraft);
    model.onCurrentPageChanged.add(saveCurrentDraft);
    uiStateChangedEvent?.add(saveCurrentDraft);
    model.onUploadFiles.add(handleUploadFiles);
    model.onClearFiles.add(handleClearFiles);
    model.onCompleting.add(handleCompleting);

    return () => {
      model.onValueChanged.remove(saveCurrentDraft);
      model.onCurrentPageChanged.remove(saveCurrentDraft);
      uiStateChangedEvent?.remove(saveCurrentDraft);
      model.onUploadFiles.remove(handleUploadFiles);
      model.onOpenDropdownMenu.remove(handleOpenDropdownMenu);
      model.onDownloadFile.remove(handleDownloadFile);
      model.onClearFiles.remove(handleClearFiles);
      model.onCompleting.remove(handleCompleting);
    };
  }, [allowAnonymousUploads, formId, isPreview, model, responseDraftStorageKey, showToast, submitResponseMutation]);

  return (
    <div className={isSubmitting ? "survey-renderer survey-renderer-submitting" : "survey-renderer"}>
      {submitError && <p style={{ color: "#991b1b", marginBottom: 10 }}>Ошибка отправки: {submitError}</p>}
      <Survey model={model} />
    </div>
  );
}
