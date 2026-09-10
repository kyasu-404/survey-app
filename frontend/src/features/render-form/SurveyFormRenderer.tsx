import { sanitizeSurveyHtml } from "../../entities/survey/model/surveyHtml";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Model,
  surveyLocalization,
  type ITheme,
  type NavigateToUrlEvent,
  type OpenDropdownMenuEvent,
  type ProcessHtmlEvent,
} from "survey-core";
import { Survey } from "survey-react-ui";
import "survey-core/survey-core.css";
import "survey-core/i18n/russian";
import { resolveDefaultSurveyLogo } from "../../entities/survey/model/defaultSurveyLogo";
import { normalizeSurveyQuestionNumbers } from "../../entities/survey/model/normalizeSurveyQuestionNumbers";
import { DEFAULT_COMPLETED_HTML } from "../../entities/survey/model/surveyModel";
import { registerCustomSurveyQuestionTypes } from "../../entities/survey/model/surveyQuestionTypes";
import { resolveSurveyTheme } from "../../entities/survey/model/surveyTheme";
import type { SurveySchema } from "../../entities/survey/types";
import {
  isSafeSurveyNavigationUrl,
  sanitizeSurveySchema,
} from "../../entities/survey/model/surveySchemaSecurity";
import { useSubmitResponseMutation, useUpdateResponseMutation } from "../submit-response/useSubmitResponse";
import { createSubmitPayload } from "../../entities/response/model/responseModel";
import type { ExistingResponseResult } from "../../entities/response/types";
import { useToast } from "../../app/providers/ToastProvider";
import { getFormOrganizations, getOrganizations } from "../../entities/organization/api";
import {
  DEFAULT_FORM_ORGANIZATION_TYPES,
  hasOrganizationQuestion,
} from "../../entities/organization/model";
import { applyOrganizationChoicesToSurvey } from "../../entities/organization/surveyQuestion";
import { getSubmitResponseErrorMessage } from "../../shared/lib/error";
import {
  getStoragePathFromSurveyFileValue,
  getStoragePathsFromResponseData,
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
import { getOrCreateResponseBrowserId } from "./responseBrowserId";

surveyLocalization.defaultLocale = "ru";

export type SurveyRenderMode =
  | "interactive"
  | "preview-interactive"
  | "preview-navigable"
  | "readonly-navigable"
  | "readonly-static";

type SurveyFormRendererProps = {
  schema: SurveySchema;
  theme?: ITheme;
  formId: string;
  respondentId?: string;
  initialData?: Record<string, unknown>;
  initialPageNo?: number;
  renderMode?: SurveyRenderMode;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
  allowResponseEditing?: boolean;
  existingResponse?: ExistingResponseResult | null;
  responseBrowserId?: string;
};

type SavedResponseState = {
  status: "submitted" | "already_submitted";
  responseId: string;
  data: Record<string, unknown>;
  editable: boolean;
};

type DropdownPopupModel = {
  focusFirstInputSelector?: string;
};

type SurveyEventLike = {
  add: (handler: (sender: Model) => void) => void;
  remove: (handler: (sender: Model) => void) => void;
};

type DownloadFileOptions = {
  fileValue?: unknown;
  callback: (status: "success" | "error", data: unknown) => void;
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

function createSubmissionId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function resolveRenderMode(renderMode: SurveyRenderMode | undefined, isPreview: boolean): SurveyRenderMode {
  return renderMode ?? (isPreview ? "preview-navigable" : "interactive");
}

function applyRenderMode(model: Model, renderMode: SurveyRenderMode) {
  if (renderMode === "interactive" || renderMode === "preview-interactive") {
    return;
  }

  model.readOnly = true;

  if (renderMode === "preview-navigable") {
    model.showNavigationButtons = true;
    model.showCompleteButton = true;
    return;
  }

  if (renderMode === "readonly-navigable") {
    model.showNavigationButtons = true;
    model.showCompleteButton = false;
    return;
  }

  model.showCompleteButton = false;
  model.showNavigationButtons = false;
  model.currentPageNo = 0;
}

async function handleDownloadFile(_sender: Model, options: DownloadFileOptions) {
  try {
    const fileContent = await resolveSurveyFileValueContent(options.fileValue);
    options.callback("success", fileContent);
  } catch (error) {
    console.error(error);
    options.callback("error", getSubmitResponseErrorMessage(error));
  }
}

export function SurveyFormRenderer({
  schema,
  theme,
  formId,
  respondentId,
  initialData,
  initialPageNo,
  renderMode,
  isPreview = false,
  allowAnonymousUploads = false,
  allowResponseEditing = false,
  existingResponse = null,
  responseBrowserId,
}: SurveyFormRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditingResponse, setIsEditingResponse] = useState(false);
  const [savedResponse, setSavedResponse] = useState<SavedResponseState | null>(() => (
    existingResponse
      ? { ...existingResponse, status: "already_submitted" }
      : null
  ));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { showToast } = useToast();
  const submitResponseMutation = useSubmitResponseMutation();
  const updateResponseMutation = useUpdateResponseMutation();
  const submissionIdRef = useRef<string>(createSubmissionId());
  const browserIdRef = useRef<string>(responseBrowserId ?? getOrCreateResponseBrowserId());
  const resolvedRenderMode = resolveRenderMode(renderMode, isPreview);
  const isInteractiveMode = resolvedRenderMode === "interactive";
  const usesOrganizationDirectory = useMemo(() => hasOrganizationQuestion(schema), [schema]);
  const responseDraftStorageKey = useMemo(
    () => (isInteractiveMode ? getSurveyResponseDraftStorageKey(formId, respondentId) : null),
    [formId, isInteractiveMode, respondentId],
  );
  const model = useMemo(() => {
    registerCustomSurveyQuestionTypes();
    const safeSchema = sanitizeSurveySchema(schema);
    const resolvedSchema = resolveDefaultSurveyLogo(
      normalizeSurveyQuestionNumbers(normalizeSurveyFileQuestions(safeSchema) as SurveySchema),
    );
    const nextModel = new Model(resolvedSchema);
    nextModel.applyTheme(resolveSurveyTheme(theme));
    nextModel.onProcessHtml.add((_sender: Model, options: ProcessHtmlEvent) => {
      options.html = sanitizeSurveyHtml(options.html);
    });
    nextModel.onNavigateToUrl.add((_sender: Model, options: NavigateToUrlEvent) => {
      options.allow = isSafeSurveyNavigationUrl(options.url);
    });
    nextModel.onDownloadFile.add(handleDownloadFile);
    nextModel.fitToContainer = false;
    nextModel.locale = resolvedSchema.locale ?? "ru";
    (nextModel as Model & { showQuestionNumbers?: boolean | string }).showQuestionNumbers = false;
    nextModel.completeText = resolvedRenderMode === "preview-navigable" ? "Завершить" : "Отправить";
    nextModel.completedHtml = sanitizeSurveyHtml(resolvedSchema.completedHtml ?? DEFAULT_COMPLETED_HTML);
    if (isInteractiveMode) {
      nextModel.showCompletePage = true;
    }
    if (initialData) {
      nextModel.data = initialData;
      if (resolvedRenderMode !== "readonly-static" && typeof initialPageNo === "number") {
        nextModel.currentPageNo = initialPageNo;
      }
    } else if (isInteractiveMode) {
      const savedDraft = loadSurveyResponseDraft(responseDraftStorageKey);
      if (savedDraft) {
        submissionIdRef.current = savedDraft.submissionId ?? createSubmissionId();
        nextModel.data = savedDraft.data;
        if (typeof savedDraft.currentPageNo === "number") {
          nextModel.currentPageNo = savedDraft.currentPageNo;
        }
        if (savedDraft.uiState) {
          restoreSurveyUIState(nextModel, savedDraft.uiState);
        }
      }
    }
    applyRenderMode(nextModel, resolvedRenderMode);
    return nextModel;
  }, [initialData, initialPageNo, isInteractiveMode, resolvedRenderMode, responseDraftStorageKey, schema, theme]);

  useEffect(() => {
    if (!existingResponse) {
      return;
    }

    setSavedResponse({ ...existingResponse, status: "already_submitted" });
    clearSurveyResponseDraft(responseDraftStorageKey);
  }, [existingResponse, responseDraftStorageKey]);

  useEffect(() => {
    if (!usesOrganizationDirectory) {
      return;
    }

    const controller = new AbortController();
    const request = formId === "__builder_preview__"
      ? getOrganizations(DEFAULT_FORM_ORGANIZATION_TYPES, controller.signal)
      : getFormOrganizations(formId, controller.signal);

    void request
      .then((organizations) => applyOrganizationChoicesToSurvey(model, organizations))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(error);
        showToast("Не удалось загрузить список организаций", "error");
      });

    return () => controller.abort();
  }, [formId, model, showToast, usesOrganizationDirectory]);

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

    model.onOpenDropdownMenu.add(handleOpenDropdownMenu);

    if (!isInteractiveMode) {
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
        submissionId: submissionIdRef.current,
      });
    };
    const uiStateChangedEvent = (model as SurveyModelWithOptionalUIState).onUIStateChanged;

    const handleUploadFiles = async (
      _sender: Model,
      options: { files: File[]; callback: (data: unknown, errors?: unknown) => void }
    ) => {
      const uploaded: Awaited<ReturnType<typeof uploadFileToStorage>>[] = [];
      try {
        for (const file of options.files) {
          uploaded.push(await uploadFileToStorage(formId, file, { allowAnonymous: allowAnonymousUploads }));
        }

        options.callback(
          uploaded.map((item) => ({
            file: item.file,
            content: item.path,
          })),
        );
      } catch (error) {
        await Promise.allSettled(
          uploaded.map((item) =>
            removeFileFromStorage(item.path, { allowAnonymous: allowAnonymousUploads, formId }),
          ),
        );
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
        if (isEditingResponse) {
          options.callback("success");
          return;
        }

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
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const payload = createSubmitPayload(formId, sender.data as Record<string, unknown>);

        if (isEditingResponse && savedResponse) {
          const previousPaths = new Set(getStoragePathsFromResponseData(savedResponse.data));
          const nextPaths = new Set(getStoragePathsFromResponseData(payload.answers));
          const updatedResponse = await updateResponseMutation.mutateAsync({
            formId: payload.formId,
            responseId: savedResponse.responseId,
            data: payload.answers,
            browserId: browserIdRef.current,
          });
          const removedPaths = [...previousPaths].filter((path) => !nextPaths.has(path));

          await Promise.allSettled(
            removedPaths.map((path) => removeFileFromStorage(path, {
              allowAnonymous: allowAnonymousUploads,
              formId,
            })),
          );
          setSavedResponse({
            ...savedResponse,
            status: "submitted",
            data: updatedResponse.data,
          });
          setIsEditingResponse(false);
          clearSurveyResponseDraft(responseDraftStorageKey);
          showToast("Изменения ответа сохранены", "success");
          return;
        }

        const result = await submitResponseMutation.mutateAsync({
          formId: payload.formId,
          data: payload.answers,
          submissionId: submissionIdRef.current,
          browserId: browserIdRef.current,
        });
        setSavedResponse(result);

        if (result.status === "already_submitted") {
          options.allowComplete = false;
          options.allow = false;
          const existingPaths = new Set(getStoragePathsFromResponseData(result.data));
          const unusedAttemptPaths = getStoragePathsFromResponseData(payload.answers)
            .filter((path) => !existingPaths.has(path));
          await Promise.allSettled(
            unusedAttemptPaths.map((path) => removeFileFromStorage(path, {
              allowAnonymous: allowAnonymousUploads,
              formId,
            })),
          );
          return;
        }

        clearSurveyResponseDraft(responseDraftStorageKey);
        showToast("Ответ успешно отправлен", "success");
      } catch (error) {
        options.allowComplete = false;
        options.allow = false;
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
  }, [
    allowAnonymousUploads,
    formId,
    isEditingResponse,
    isInteractiveMode,
    model,
    responseDraftStorageKey,
    savedResponse,
    showToast,
    submitResponseMutation,
    updateResponseMutation,
  ]);

  const canEditSavedResponse = Boolean(savedResponse?.editable && allowResponseEditing);
  const handleStartResponseEditing = () => {
    if (!savedResponse || !canEditSavedResponse) {
      return;
    }

    model.clear(false, true);
    model.data = savedResponse.data;
    model.currentPageNo = 0;
    model.completeText = "Сохранить изменения";
    setSubmitError(null);
    setIsEditingResponse(true);
  };

  return (
    <div className={isSubmitting ? "survey-renderer survey-renderer-submitting" : "survey-renderer"}>
      {submitError && <p style={{ color: "#991b1b", marginBottom: 10 }}>Ошибка отправки: {submitError}</p>}
      {savedResponse?.status === "already_submitted" && !isEditingResponse && (
        <div className="survey-response-already-submitted" role="status">
          <p>Вы уже отправляли ответ на эту форму.</p>
          {canEditSavedResponse && (
            <button type="button" onClick={handleStartResponseEditing}>Редактировать</button>
          )}
        </div>
      )}
      {(savedResponse?.status !== "already_submitted" || isEditingResponse) && <Survey model={model} />}
    </div>
  );
}
