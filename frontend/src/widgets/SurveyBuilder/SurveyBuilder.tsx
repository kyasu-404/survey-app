import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type ITheme } from "survey-core";
import {
  type UploadFileEvent
} from "survey-creator-core";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import { canManageSurveyForm, FORM_EDIT_PERMISSION_ERROR } from "../../entities/survey/model/formAccess";
import { Presence } from "../../shared/ui/Presence";
import { BuilderCompatibilityDialog, BuilderFormSettingsDialog, BuilderResetDialog } from "./BuilderDialogs";
import type { CompatibilityDialogState, ExistingFormSaveRequest, PostSaveSettingsState } from "./builderTypes";
import {
  applyThemeToBuilderDesigners,
  applyThemeToCreatorAndEditor,
  createCreatorInstance,
  createEmptyBuilderSchema,
  enableThemePageTitleFontEditor,
  getSchemaTitle,
  getSerializedBuilderSchema,
  toBuilderSchema,
  updateRuntimePreviewBridgeFromCreator,
} from "./creatorSetup";
import { useSafeSchemaEditing } from "./useSafeSchemaEditing";

import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import {
  DEFAULT_FORM_ORGANIZATION_TYPES,
  normalizeOrganizationTypes
} from "../../entities/organization/model";
import type { OrganizationType } from "../../entities/organization/types";
import {
  cloneForm,
  getFormById,
  saveSurveySchema,
} from "../../entities/survey/api/surveysApi";
import { createSurveyAssetFormId, uploadSurveyBackground } from "../../entities/survey/api/themeAssets";
import {
  resolveDefaultSurveyLogo
} from "../../entities/survey/model/defaultSurveyLogo";
import {
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  DASHBOARD_FORMS_QUERY_ROOT,
  getFormQueryKey,
  getSurveyFormQueryKey,
  TEMPLATE_FORMS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { createEmptySurveySchema, isTemplateForm, TEMPLATE_FORM_TYPE } from "../../entities/survey/model/surveyModel";
import {
  DEFAULT_SURVEY_THEME,
  resolveSurveyTheme,
  sanitizeSurveyTheme,
  withSurveyBackground,
  withUploadedSurveyThemeImage
} from "../../entities/survey/model/surveyTheme";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import type { SurveySchema } from "../../entities/survey/types";
import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useMobileLayout } from "../../shared/ui/useMobileLayout";
import { clearSurveyBuilderDraft, loadSurveyBuilderDraft, saveSurveyBuilderDraft } from "./builderDraft";
import { updateBuilderPreviewBridge } from "./builderPreviewBridge";
import { MobileBuilderToolbar } from "./MobileBuilderToolbar";
import { ThemeBackgroundGallery } from "./ThemeBackgroundGallery";

type SurveyBuilderProps = {
  canAdministerAllForms?: boolean;
  formId?: string;
  safeEditingResponseCount?: number;
  userId: string;
};

const BUILDER_RUNTIME_PREVIEW_SYNC_DELAY_MS = 75;
export function SurveyBuilder({
  canAdministerAllForms = false,
  formId,
  safeEditingResponseCount = 0,
  userId,
}: SurveyBuilderProps) {
  const isMobile = useMobileLayout();
  const [isSaving, setIsSaving] = useState(false);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  useEffect(() => {
    if (!creator) return;
    // The desktop toolbox is hidden by SurveyJS on narrow screens. Keep its
    // tap-to-add alternative available and start with the form canvas visible.
    creator.showAddQuestionButton = isMobile;
    if (isMobile) creator.showSidebar = false;
  }, [creator, isMobile]);
  const [isTemplateActionLoading, setIsTemplateActionLoading] = useState<"save" | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [postSaveSettings, setPostSaveSettings] = useState<PostSaveSettingsState | null>(null);
  const [isPostSaveSettingsSaving, setIsPostSaveSettingsSaving] = useState(false);
  const [isBackgroundGalleryOpen, setIsBackgroundGalleryOpen] = useState(false);
  const [galleryBackground, setGalleryBackground] = useState("");
  const [responseEditingEnabled, setResponseEditingEnabled] = useState(false);
  const [compatibilityDialog, setCompatibilityDialog] = useState<CompatibilityDialogState | null>(null);
  const [isCompatibilityCopying, setIsCompatibilityCopying] = useState(false);
  const [organizationTypes, setOrganizationTypes] = useState<OrganizationType[]>(
    DEFAULT_FORM_ORGANIZATION_TYPES,
  );
  const { showToast } = useToast();
  const { theme: applicationTheme } = useTheme();
  const createSurveyMutation = useCreateSurveyMutation();
  const saveSurveyMutation = useMutation({
    mutationFn: ({
      id,
      schema,
      theme,
      title,
      allowResponseEditing,
      selectedOrganizationTypes,
      expectedRevision,
      confirmWarnings = false,
    }: {
      id: string;
      schema: SurveySchema;
      theme: ITheme;
      title: string;
      allowResponseEditing: boolean;
      selectedOrganizationTypes: OrganizationType[];
      expectedRevision: number;
      confirmWarnings?: boolean;
    }) => confirmWarnings
      ? saveSurveySchema(
          id,
          schema,
          theme,
          title,
          allowResponseEditing,
          selectedOrganizationTypes,
          expectedRevision,
          true,
        )
      : saveSurveySchema(
          id,
          schema,
          theme,
          title,
          allowResponseEditing,
          selectedOrganizationTypes,
          expectedRevision,
        ),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);
  const isSafeEditingMode = isEditMode && safeEditingResponseCount > 0;
  const safeEditingModeRef = useRef(isSafeEditingMode);
  safeEditingModeRef.current = isSafeEditingMode;
  const isSurveyMutationBusy = isSaving || saveSurveyMutation.isPending || createSurveyMutation.isPending;
  const isTemplateBusy = isTemplateActionLoading !== null;
  const saveTemplateHandlerRef = useRef<() => void>(() => undefined);
  const draftHydrationStateRef = useRef<"idle" | "loaded" | "empty">("idle");
  const editorRevisionRef = useRef<number | undefined>(undefined);
  const editorDirtyRef = useRef(false);
  const hydratingEditorRef = useRef(false);
  const runtimePreviewSyncTimeoutRef = useRef<number | null>(null);
  const assetFormIdRef = useRef(formId ?? createSurveyAssetFormId());
  const creatorThemeRef = useRef(applicationTheme.creator);
  creatorThemeRef.current = applicationTheme.creator;

  const clearScheduledRuntimePreviewSync = useCallback(() => {
    if (runtimePreviewSyncTimeoutRef.current) {
      window.clearTimeout(runtimePreviewSyncTimeoutRef.current);
      runtimePreviewSyncTimeoutRef.current = null;
    }
  }, []);

  const syncRuntimePreviewNow = useCallback(
    (targetCreator: SurveyCreator) => {
      clearScheduledRuntimePreviewSync();
      updateRuntimePreviewBridgeFromCreator(targetCreator, formId);
    },
    [clearScheduledRuntimePreviewSync, formId],
  );

  const {
    data: loadedForm,
    isLoading: isEditableFormLoading,
    error: editableFormError,
  } = useQuery({
    queryKey: getFormQueryKey(formId),
    queryFn: async ({ signal }) => {
      const form = await getFormById(formId ?? "", { signal });
      if (form && !canManageSurveyForm(form, userId, canAdministerAllForms)) {
        throw new Error(FORM_EDIT_PERMISSION_ERROR);
      }
      return form;
    },
    enabled: isEditMode,
    retry: (failureCount, error) =>
      !(error instanceof Error && error.message === "У вас нет прав на редактирование этой формы") &&
      failureCount < 1,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const canEditLoadedForm = Boolean(loadedForm && canManageSurveyForm(loadedForm, userId, canAdministerAllForms));
  const editableForm = canEditLoadedForm ? loadedForm : undefined;

  useEffect(() => {
    assetFormIdRef.current = formId ?? createSurveyAssetFormId();
    const nextCreator = createCreatorInstance(formId, creatorThemeRef.current, () => safeEditingModeRef.current);
    setCreator(nextCreator);
    setOrganizationTypes([...DEFAULT_FORM_ORGANIZATION_TYPES]);
    draftHydrationStateRef.current = "idle";
    editorRevisionRef.current = undefined;
    editorDirtyRef.current = false;
    updateRuntimePreviewBridgeFromCreator(nextCreator, formId);

    return () => {
      clearScheduledRuntimePreviewSync();
      updateBuilderPreviewBridge({
        previewSchema: createEmptySurveySchema(),
        previewTheme: DEFAULT_SURVEY_THEME,
        formId: undefined,
      });
      nextCreator.dispose();
    };
  }, [clearScheduledRuntimePreviewSync, formId]);

  useEffect(() => {
    creator?.applyCreatorTheme(applicationTheme.creator);
  }, [applicationTheme.creator, creator]);

  useEffect(() => {
    draftHydrationStateRef.current = "idle";
  }, [formId]);

  useEffect(() => {
    if (!editableFormError || isAbortError(editableFormError)) {
      return;
    }

    showToast(getErrorMessage(editableFormError, "Не удалось загрузить форму"), "error");
  }, [editableFormError, showToast]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const restoredDraft = loadSurveyBuilderDraft(userId, formId);

    if (restoredDraft) {
      draftHydrationStateRef.current = "loaded";
      editorRevisionRef.current = restoredDraft.baseRevision;
      editorDirtyRef.current = true;
      if (!formId && restoredDraft.assetFormId) assetFormIdRef.current = restoredDraft.assetFormId;
      hydratingEditorRef.current = true;
      try {
        creator.locale = restoredDraft.schema.locale ?? "ru";
        creator.theme = resolveSurveyTheme(restoredDraft.theme);
        applyThemeToBuilderDesigners(creator);
        creator.JSON = resolveDefaultSurveyLogo(toBuilderSchema(restoredDraft.schema, "Новая форма"));
      } finally { hydratingEditorRef.current = false; }
      syncRuntimePreviewNow(creator);
      return;
    }

    draftHydrationStateRef.current = "empty";
    syncRuntimePreviewNow(creator);
  }, [creator, formId, syncRuntimePreviewNow, userId]);

  useEffect(() => {
    if (!creator || !editableForm || draftHydrationStateRef.current === "loaded" || editorDirtyRef.current) {
      return;
    }

    editorRevisionRef.current = editableForm.revision ?? 0;
    hydratingEditorRef.current = true;
    try {
      creator.locale = editableForm.schema.locale ?? "ru";
      creator.theme = resolveSurveyTheme(editableForm.theme);
      applyThemeToBuilderDesigners(creator);
      creator.JSON = resolveDefaultSurveyLogo(
        toBuilderSchema(
          {
            ...editableForm.schema,
            title: editableForm.title,
          },
          editableForm.title,
        ),
      );
    } finally { hydratingEditorRef.current = false; }
    syncRuntimePreviewNow(creator);
  }, [creator, editableForm, syncRuntimePreviewNow]);

  useEffect(() => {
    setResponseEditingEnabled(editableForm?.allow_response_editing ?? false);
  }, [editableForm?.allow_response_editing, formId]);

  useEffect(() => {
    setOrganizationTypes(normalizeOrganizationTypes(editableForm?.organization_types));
  }, [editableForm?.organization_types, formId]);

  useSafeSchemaEditing(creator, editableForm?.schema, isSafeEditingMode);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const handleModified = () => {
      if (hydratingEditorRef.current) return;
      editorDirtyRef.current = true;
      saveSurveyBuilderDraft(
        userId,
        formId,
        getSerializedBuilderSchema(creator),
        sanitizeSurveyTheme(creator.theme),
        assetFormIdRef.current,
        editorRevisionRef.current,
      );

      clearScheduledRuntimePreviewSync();
      runtimePreviewSyncTimeoutRef.current = window.setTimeout(() => {
        runtimePreviewSyncTimeoutRef.current = null;
        updateRuntimePreviewBridgeFromCreator(creator, formId);
      }, BUILDER_RUNTIME_PREVIEW_SYNC_DELAY_MS);
    };

    const handleThemeModified = () => {
      applyThemeToBuilderDesigners(creator);
      handleModified();
    };

    creator.onModified.add(handleModified);
    creator.themeEditor.onThemePropertyChanged.add(handleThemeModified);
    creator.themeEditor.onThemeSelected.add(handleThemeModified);

    return () => {
      creator.onModified.remove(handleModified);
      creator.themeEditor.onThemePropertyChanged.remove(handleThemeModified);
      creator.themeEditor.onThemeSelected.remove(handleThemeModified);
      clearScheduledRuntimePreviewSync();
    };
  }, [clearScheduledRuntimePreviewSync, creator, formId, userId]);

  useEffect(() => {
    if (!creator) return;

    const handleUploadFile = async (_sender: unknown, options: UploadFileEvent) => {
      const file = options.files?.[0];
      if (!file) {
        options.callback("error");
        return;
      }

      try {
        const uploaded = await uploadSurveyBackground(
          assetFormIdRef.current,
          editableForm?.author_id ?? userId,
          file,
        );
        options.callback("success", uploaded.url);

        const uploadedElementType = options.elementType?.toString();
        const uploadedPropertyName = options.propertyName?.toString();

        if (
          uploadedPropertyName === "backgroundImage"
          && (uploadedElementType === "theme" || uploadedElementType === "header")
        ) {
          const uploadedTheme = withUploadedSurveyThemeImage(
            creator.theme,
            uploadedElementType,
            uploadedPropertyName,
            uploaded.url,
          );
          applyThemeToCreatorAndEditor(creator, uploadedTheme);
          applyThemeToBuilderDesigners(creator);
          setGalleryBackground(creator.theme.backgroundImage ?? "");
          saveSurveyBuilderDraft(
            userId,
            formId,
            getSerializedBuilderSchema(creator),
            creator.theme,
            assetFormIdRef.current,
            editorRevisionRef.current,
          );
          syncRuntimePreviewNow(creator);
        }
      } catch (error) {
        console.error(error);
        showToast(getErrorMessage(error, "Не удалось загрузить изображение"), "error");
        options.callback("error");
      }
    };

    creator.onUploadFile.add(handleUploadFile);
    return () => creator.onUploadFile.remove(handleUploadFile);
  }, [creator, editableForm?.author_id, formId, showToast, syncRuntimePreviewNow, userId]);

  const scheduleBuilderQueryRefresh = (affectedFormId?: string) => {
    const targets: Array<{ queryKey: readonly unknown[] }> = [
      { queryKey: DASHBOARD_FORMS_QUERY_ROOT },
      { queryKey: DASHBOARD_FORM_STATS_QUERY_ROOT },
      { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
      { queryKey: ["builder-templates"] },
    ];

    if (affectedFormId) {
      targets.push(
        { queryKey: getFormQueryKey(affectedFormId) },
        { queryKey: getSurveyFormQueryKey(affectedFormId) },
      );
    }

    scheduleQueryInvalidation(queryClient, affectedFormId ? `builder refresh ${affectedFormId}` : "builder refresh", targets);
  };

  const navigateToSavedList = (target: "forms" | "templates") => {
    navigate(target === "templates" ? routes.templates : routes.dashboardMy, {
      replace: true,
      state: { refreshList: true },
    });
  };

  const clearCurrentBuilderState = () => {
    clearSurveyBuilderDraft(userId, formId);

    if (!creator) {
      return;
    }

    const emptySchema = createEmptyBuilderSchema();
    if (!formId) assetFormIdRef.current = createSurveyAssetFormId();
    creator.locale = emptySchema.locale ?? "ru";
    creator.theme = resolveSurveyTheme(DEFAULT_SURVEY_THEME);
    applyThemeToBuilderDesigners(creator);
    creator.JSON = resolveDefaultSurveyLogo(emptySchema);
    setOrganizationTypes([...DEFAULT_FORM_ORGANIZATION_TYPES]);
    draftHydrationStateRef.current = "empty";
    syncRuntimePreviewNow(creator);
  };

  const handleSaveAsTemplate = async () => {
    if (!creator) {
      return;
    }

    setIsTemplateActionLoading("save");
    const stopPendingLogger = createPendingStateLogger(queryClient, "builder save template");

    try {
      const schema = getSerializedBuilderSchema(creator);
      if (!validateSurveySchema(schema)) {
        throw new Error("Некорректная JSON-схема формы");
      }

      const title = getSchemaTitle(schema, editableForm?.title ?? "Новый шаблон");
      const theme = sanitizeSurveyTheme(creator.theme);
      const templateId = formId ? createSurveyAssetFormId() : assetFormIdRef.current;

      await createSurveyMutation.mutateAsync({
        id: templateId,
        schema,
        theme,
        title,
        formType: TEMPLATE_FORM_TYPE,
        organizationTypes,
        isPublic: false,
      });

      scheduleBuilderQueryRefresh();
      clearCurrentBuilderState();
      showToast("Шаблон сохранён", "success");
      navigateToSavedList("templates");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось сохранить шаблон"), "error");
    } finally {
      stopPendingLogger();
      setIsTemplateActionLoading(null);
    }
  };

  saveTemplateHandlerRef.current = () => {
    void handleSaveAsTemplate();
  };

  const handleResetBuilder = () => {
    if (!creator) {
      return;
    }

    if (isSafeEditingMode) {
      setIsResetConfirmOpen(false);
      showToast(
        "Сбросить форму с ответами нельзя. Создайте копию для изменения структуры.",
        "warning",
      );
      return;
    }

    const emptySchema = createEmptyBuilderSchema();
    if (!formId) assetFormIdRef.current = createSurveyAssetFormId();
    creator.locale = emptySchema.locale ?? "ru";
    creator.theme = resolveSurveyTheme(DEFAULT_SURVEY_THEME);
    applyThemeToBuilderDesigners(creator);
    creator.JSON = resolveDefaultSurveyLogo(emptySchema);
    saveSurveyBuilderDraft(userId, formId, emptySchema, creator.theme, assetFormIdRef.current, editorRevisionRef.current);
    draftHydrationStateRef.current = "loaded";
    syncRuntimePreviewNow(creator);
    setIsResetConfirmOpen(false);
    showToast("Конструктор очищен", "success");
  };

  useEffect(() => {
    if (!creator) {
      return;
    }

    const syncCustomToolbarActions = (_sender?: unknown, options?: { tabName?: string }) => {
      const isThemeTab = (options?.tabName ?? creator.activeTab) === "theme";
      const galleryAction = creator.toolbar.getActionById("builder-background-gallery");
      const resetAction = creator.toolbar.getActionById("builder-reset");
      const saveTemplateAction = creator.toolbar.getActionById("builder-save-template");

      if (galleryAction) galleryAction.visible = isThemeTab;
      if (resetAction) resetAction.visible = !isThemeTab && !isSafeEditingMode;
      if (saveTemplateAction) saveTemplateAction.visible = !isThemeTab;
      if (isThemeTab) enableThemePageTitleFontEditor(creator);
    };

    creator.toolbar.addAction(
      {
        id: "builder-background-gallery",
        title: "Галерея фонов",
        showTitle: true,
        visible: creator.activeTab === "theme",
        css: "builder-toolbar-action-item",
        innerCss: "builder-toolbar-action-button",
        action: () => {
          setGalleryBackground(creator.theme.backgroundImage ?? "");
          setIsBackgroundGalleryOpen(true);
        },
      },
      true,
    );

    creator.toolbar.addAction(
      {
        id: "builder-reset",
        title: "Сбросить",
        tooltip: "Сбросить конструктор",
        showTitle: false,
        iconName: "icon-reset",
        css: "builder-toolbar-icon-item",
        innerCss: "builder-toolbar-icon-button",
        action: () => {
          setIsResetConfirmOpen(true);
        },
      },
      true,
    );

    creator.toolbar.addAction(
      {
        id: "builder-save-template",
        title: "Сохранить как шаблон",
        showTitle: true,
        css: "builder-toolbar-action-item",
        innerCss: "builder-toolbar-action-button",
        action: () => {
          saveTemplateHandlerRef.current();
        },
      },
      true,
    );

    const resetAction = creator.toolbar.getActionById("builder-reset");
    const galleryAction = creator.toolbar.getActionById("builder-background-gallery");
    const saveTemplateAction = creator.toolbar.getActionById("builder-save-template");

    if (resetAction) {
      resetAction.visibleIndex = 9;
    }

    if (galleryAction) galleryAction.visibleIndex = 8;

    if (saveTemplateAction) {
      saveTemplateAction.visibleIndex = 10;
    }

    syncCustomToolbarActions();
    creator.onActiveTabChanged.add(syncCustomToolbarActions);

    return () => {
      creator.onActiveTabChanged.remove(syncCustomToolbarActions);
      creator.toolbar.actions = creator.toolbar.actions.filter(
        (action) =>
          action.id !== "builder-background-gallery" &&
          action.id !== "builder-reset" &&
          action.id !== "builder-save-template",
      );
    };
  }, [creator, isSafeEditingMode]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const resetAction = creator.toolbar.actions.find((action) => action.id === "builder-reset");
    const galleryAction = creator.toolbar.actions.find((action) => action.id === "builder-background-gallery");
    const saveAction = creator.toolbar.actions.find((action) => action.id === "svd-save");
    const saveTemplateAction = creator.toolbar.actions.find((action) => action.id === "builder-save-template");

    if (resetAction) {
      resetAction.enabled = !isSurveyMutationBusy && !isTemplateBusy;
      resetAction.innerCss = "builder-toolbar-icon-button";
    }

    if (galleryAction) {
      galleryAction.enabled = !isSurveyMutationBusy && !isTemplateBusy;
      galleryAction.innerCss = "builder-toolbar-action-button";
    }

    if (saveAction) {
      saveAction.css = "builder-toolbar-icon-item";
      saveAction.innerCss = `builder-toolbar-icon-button ${isSaving ? "builder-toolbar-action-button-pending" : ""}`.trim();
    }

    if (saveTemplateAction) {
      saveTemplateAction.enabled = !isSurveyMutationBusy && !isTemplateBusy;
      saveTemplateAction.innerCss = `builder-toolbar-action-button ${
        isTemplateActionLoading === "save" ? "builder-toolbar-action-button-pending" : ""
      }`.trim();
    }

  }, [creator, isSaving, isSurveyMutationBusy, isTemplateActionLoading, isTemplateBusy]);

  const closePostSaveSettings = () => {
    setPostSaveSettings(null);
  };

  const handleSavePostSaveSettings = async () => {
    if (!postSaveSettings) {
      return;
    }

    const normalizedFormType = postSaveSettings.formTypeValue.trim();
    const normalizedFormReason = postSaveSettings.formReasonValue.trim();
    const normalizedDeadline = postSaveSettings.deadlineValue.trim();
    const normalizedLimit = postSaveSettings.responseLimitValue.trim();
    let deadlineAt: string | null = null;
    let maxResponses: number | null = null;

    if (!normalizedFormType || !normalizedFormReason) {
      showToast("Выберите тип формы и основание формы", "error");
      return;
    }

    if (normalizedDeadline) {
      const parsedDate = new Date(normalizedDeadline);
      if (Number.isNaN(parsedDate.getTime())) {
        showToast("Некорректный формат даты дедлайна", "error");
        return;
      }
      deadlineAt = parsedDate.toISOString();
    }

    if (normalizedLimit) {
      const parsedLimit = Number(normalizedLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        showToast("Укажите положительное целое число ответов", "error");
        return;
      }
      maxResponses = parsedLimit;
    }

    setIsPostSaveSettingsSaving(true);
    const stopPendingLogger = createPendingStateLogger(queryClient, "builder post-save settings");

    try {
      const createdForm = await createSurveyMutation.mutateAsync({
        id: postSaveSettings.assetFormId,
        schema: postSaveSettings.schema,
        theme: postSaveSettings.theme,
        title: postSaveSettings.title,
        formType: normalizedFormType,
        formReason: normalizedFormReason,
        deadlineAt,
        maxResponses,
        allowResponseEditing: postSaveSettings.allowResponseEditing,
        organizationTypes: postSaveSettings.organizationTypes,
        isPublic: true,
      });

      clearSurveyBuilderDraft(userId, formId);
      scheduleBuilderQueryRefresh(createdForm.id);
      setPostSaveSettings(null);
      showToast("Форма сохранена", "success");
      navigateToSavedList("forms");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось сохранить настройки формы"), "error");
    } finally {
      stopPendingLogger();
      setIsPostSaveSettingsSaving(false);
    }
  };

  useEffect(() => {
    if (!creator) {
      return;
    }

    const saveBuilder = async (saveNo: number, callback: (saveNo: number, isSuccess: boolean) => void) => {
      setIsSaving(true);
      const stopPendingLogger = createPendingStateLogger(queryClient, formId ? `builder save ${formId}` : "builder create");

      try {
        const schema = getSerializedBuilderSchema(creator);
        if (!validateSurveySchema(schema)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        const title = getSchemaTitle(schema, editableForm?.title ?? "Новая форма");
        const theme = sanitizeSurveyTheme(creator.theme);

        const savedFormId = formId;
        const isTemplate = Boolean(editableForm && isTemplateForm(editableForm));

        if (formId) {
          if (editorRevisionRef.current === undefined) {
            throw new Error("У черновика неизвестна исходная версия. Сохраните его как шаблон и откройте актуальную форму.");
          }
          const request: ExistingFormSaveRequest = {
            expectedRevision: editorRevisionRef.current,
            allowResponseEditing: editableForm?.allow_response_editing ?? responseEditingEnabled,
            callback,
            id: formId,
            isTemplate,
            saveNo,
            schema,
            selectedOrganizationTypes: editableForm ? normalizeOrganizationTypes(editableForm.organization_types) : organizationTypes,
            theme,
            title,
          };
          const result = await saveSurveyMutation.mutateAsync(request);

          if (result?.status === "confirmation_required") {
            setCompatibilityDialog({ request, result });
            return;
          }

          if (result?.status === "blocked") {
            setCompatibilityDialog({ request, result });
            callback(saveNo, false);
            return;
          }
        } else {
          setPostSaveSettings({
            title,
            schema,
            theme,
            assetFormId: assetFormIdRef.current,
            deadlineValue: "",
            responseLimitValue: "",
            formTypeValue: "",
            formReasonValue: "",
            allowResponseEditing: responseEditingEnabled,
            organizationTypes,
          });
          callback(saveNo, true);
          return;
        }

        scheduleBuilderQueryRefresh(savedFormId);
        showToast(isTemplate ? "Шаблон обновлён" : "Форма обновлена", "success");
        clearSurveyBuilderDraft(userId, formId);

        if (isTemplate) {
          clearCurrentBuilderState();
          navigateToSavedList("templates");
        } else {
          navigateToSavedList("forms");
        }
        callback(saveNo, true);
      } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : "Не удалось сохранить форму";
        showToast(
          errorMessage === "Пользователь не авторизован"
            ? "Вы не авторизованы. Войдите в систему и повторите попытку"
            : errorMessage,
          "error",
        );
        callback(saveNo, false);
      } finally {
        stopPendingLogger();
        setIsSaving(false);
      }
    };

    creator.saveSurveyFunc = saveBuilder;
    creator.saveThemeFunc = saveBuilder;

    return () => {
      creator.saveSurveyFunc = undefined;
      creator.saveThemeFunc = undefined;
    };
  }, [creator, createSurveyMutation, editableForm, formId, navigate, organizationTypes, queryClient, responseEditingEnabled, saveSurveyMutation, showToast, userId]);

  const handleCloseCompatibilityDialog = () => {
    if (compatibilityDialog?.result.status === "confirmation_required") {
      compatibilityDialog.request.callback(compatibilityDialog.request.saveNo, false);
    }
    setCompatibilityDialog(null);
  };

  const handleConfirmCompatibilityWarnings = async () => {
    if (!compatibilityDialog || compatibilityDialog.result.status !== "confirmation_required") {
      return;
    }

    const { request } = compatibilityDialog;
    setIsSaving(true);
    const stopPendingLogger = createPendingStateLogger(queryClient, `builder safe save ${request.id}`);

    try {
      const result = await saveSurveyMutation.mutateAsync({ ...request, confirmWarnings: true });
      if (result?.status === "blocked" || result?.status === "confirmation_required") {
        setCompatibilityDialog({ request, result });
        if (result.status === "blocked") {
          request.callback(request.saveNo, false);
        }
        return;
      }

      setCompatibilityDialog(null);
      scheduleBuilderQueryRefresh(request.id);
      showToast(request.isTemplate ? "Шаблон обновлён" : "Форма обновлена", "success");
      clearSurveyBuilderDraft(userId, formId);

      if (request.isTemplate) {
        clearCurrentBuilderState();
        navigateToSavedList("templates");
      } else {
        navigateToSavedList("forms");
      }
      request.callback(request.saveNo, true);
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось сохранить форму"), "error");
      request.callback(request.saveNo, false);
      setCompatibilityDialog(null);
    } finally {
      stopPendingLogger();
      setIsSaving(false);
    }
  };

  const handleCreateCompatibilityCopy = async () => {
    if (!compatibilityDialog || !editableForm) {
      return;
    }

    const { request } = compatibilityDialog;
    setIsCompatibilityCopying(true);
    try {
      const copy = await cloneForm({
        ...editableForm,
        title: request.title,
        schema: request.schema,
        theme: request.theme,
        allow_response_editing: request.allowResponseEditing,
        organization_types: request.selectedOrganizationTypes,
      }, userId);
      clearSurveyBuilderDraft(userId, formId);
      scheduleBuilderQueryRefresh(copy.id);
      setCompatibilityDialog(null);
      showToast("Копия формы создана с внесёнными изменениями", "success");
      navigate(routes.builderEdit(copy.id), { replace: true });
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось создать копию формы"), "error");
    } finally {
      setIsCompatibilityCopying(false);
    }
  };

  const handleApplyBackground = useCallback((backgroundUrl: string) => {
    if (!creator) return;
    editorDirtyRef.current = true;
    const themeWithBackground = withSurveyBackground(creator.theme, backgroundUrl);
    applyThemeToCreatorAndEditor(creator, themeWithBackground);
    applyThemeToBuilderDesigners(creator);
    setGalleryBackground(backgroundUrl);
    saveSurveyBuilderDraft(
      userId,
      formId,
      getSerializedBuilderSchema(creator),
      creator.theme,
      assetFormIdRef.current,
      editorRevisionRef.current,
    );
    syncRuntimePreviewNow(creator);
  }, [creator, formId, syncRuntimePreviewNow, userId]);

  const handleBackgroundGalleryError = useCallback((message: string) => {
    showToast(message, "error");
  }, [showToast]);

  if (isEditMode && !canEditLoadedForm) {
    if (isEditableFormLoading) return <Skeleton className="builder-loading-skeleton-line" />;
    return <p role="alert">{loadedForm ? FORM_EDIT_PERMISSION_ERROR : getErrorMessage(editableFormError, "Форма не найдена")}</p>;
  }

  return (
    <div className="builder-host">
      {isMobile && creator && <MobileBuilderToolbar
        creator={creator}
        busy={isSurveyMutationBusy || isTemplateBusy}
        safeEditing={isSafeEditingMode}
        onSaveTemplate={() => saveTemplateHandlerRef.current()}
        onGallery={() => {
          setGalleryBackground(creator.theme.backgroundImage ?? "");
          setIsBackgroundGalleryOpen(true);
        }}
        onReset={() => setIsResetConfirmOpen(true)}
      />}
      <div className="builder-status-stack">
        {isSafeEditingMode && (
          <p className="builder-safe-editing-banner" role="status">
            У формы есть {safeEditingResponseCount} ответов. Включён безопасный режим редактирования.
          </p>
        )}
        {isEditableFormLoading && (
          <div className="builder-loading-skeleton" aria-hidden="true">
            <Skeleton className="builder-loading-skeleton-line builder-loading-skeleton-line-title" />
            <Skeleton className="builder-loading-skeleton-line" />
            <Skeleton className="builder-loading-skeleton-line builder-loading-skeleton-line-short" />
          </div>
        )}
      </div>

      <div className="builder-creator-shell">
        {creator && <SurveyCreatorComponent creator={creator} />}
      </div>

      <Presence kind="modal">{isBackgroundGalleryOpen && creator && (
        <ThemeBackgroundGallery
          currentBackground={galleryBackground}
          formId={assetFormIdRef.current}
          ownerId={editableForm?.author_id ?? userId}
          onApply={handleApplyBackground}
          onClose={() => setIsBackgroundGalleryOpen(false)}
          onError={handleBackgroundGalleryError}
        />
      )}</Presence>

      <Presence kind="modal">{isResetConfirmOpen && (
        <BuilderResetDialog
            isSurveyMutationBusy={isSurveyMutationBusy}
            isTemplateBusy={isTemplateBusy}
            setIsResetConfirmOpen={setIsResetConfirmOpen}
            handleResetBuilder={handleResetBuilder}
        />
      )}</Presence>

      <Presence kind="modal">{compatibilityDialog && (
        <BuilderCompatibilityDialog
            compatibilityDialog={compatibilityDialog}
            isCompatibilityCopying={isCompatibilityCopying}
            isSaving={isSaving}
            handleCreateCompatibilityCopy={handleCreateCompatibilityCopy}
            handleCloseCompatibilityDialog={handleCloseCompatibilityDialog}
            handleConfirmCompatibilityWarnings={handleConfirmCompatibilityWarnings}
        />
      )}</Presence>

      <Presence kind="modal">{postSaveSettings && (
        <BuilderFormSettingsDialog
            postSaveSettings={postSaveSettings}
            setPostSaveSettings={setPostSaveSettings}
            isPostSaveSettingsSaving={isPostSaveSettingsSaving}
            closePostSaveSettings={closePostSaveSettings}
            handleSavePostSaveSettings={handleSavePostSaveSettings}
        />
      )}</Presence>
    </div>
  );
}
