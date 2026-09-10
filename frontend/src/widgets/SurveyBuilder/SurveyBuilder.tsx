import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  editorLocalization,
  registerCreatorTheme,
  registerSurveyTheme,
  type ICreatorTheme,
  type ICreatorPlugin,
  type UploadFileEvent,
} from "survey-creator-core";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import { Serializer, SvgRegistry, surveyLocalization, type ITheme } from "survey-core";
import SurveyTheme from "survey-core/themes";
import "survey-creator-core/survey-creator-core.css";
import "survey-core/survey-core.css";
import "survey-core/i18n/russian";
import "survey-creator-core/i18n/russian";
import phoneIcon from "../../img/constructor/Phone.svg?raw";
import emailIcon from "../../img/constructor/Email.svg?raw";
import floatIcon from "../../img/constructor/float.svg?raw";
import integerIcon from "../../img/constructor/integer.svg?raw";
import dateIcon from "../../img/constructor/Date.svg?raw";
import timeIcon from "../../img/constructor/Time.svg?raw";
import dateTimeIcon from "../../img/constructor/Date-Time.svg?raw";
import sectionTitleIcon from "../../img/constructor/Title.svg?raw";

import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import {
  DEFAULT_FORM_ORGANIZATION_TYPES,
  hasOrganizationQuestion,
  normalizeOrganizationTypes,
  ORGANIZATION_TYPE_OPTIONS,
} from "../../entities/organization/model";
import type { OrganizationType } from "../../entities/organization/types";
import {
  cloneForm,
  getFormById,
  saveSurveySchema,
} from "../../entities/survey/api/surveysApi";
import type { SchemaUpdateResult } from "../../entities/survey/api/surveysApi";
import {
  FORM_REASON_OPTIONS,
  REGULAR_FORM_TYPE_OPTIONS,
} from "../../entities/survey/model/formOptions";
import {
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "../../entities/survey/model/defaultSurveyLogo";
import { normalizeSurveyQuestionNumbers } from "../../entities/survey/model/normalizeSurveyQuestionNumbers";
import {
  DEFAULT_SURVEY_THEME,
  resolveBuilderDesignerTheme,
  resolveSurveyTheme,
  sanitizeSurveyTheme,
  withSurveyBackground,
  withUploadedSurveyThemeImage,
} from "../../entities/survey/model/surveyTheme";
import { TEMPLATE_FORM_TYPE, createEmptySurveySchema, isTemplateForm } from "../../entities/survey/model/surveyModel";
import {
  QUESTION_TYPE_DEFINITIONS,
  QUESTION_TYPES,
  registerCustomSurveyQuestionTypes,
  type SurveyQuestionType,
} from "../../entities/survey/model/surveyQuestionTypes";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import { sanitizeSurveySchema } from "../../entities/survey/model/surveySchemaSecurity";
import type { SurveySchema } from "../../entities/survey/types";
import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import {
  DASHBOARD_FORMS_QUERY_ROOT,
  DASHBOARD_FORM_STATS_QUERY_ROOT,
  getFormQueryKey,
  getSurveyFormQueryKey,
  TEMPLATE_FORMS_QUERY_ROOT,
} from "../../entities/survey/model/queryKeys";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { creatorThemes } from "../../shared/theme/themeRegistry";
import { createSurveyAssetFormId, uploadSurveyBackground } from "../../shared/api/themeAssets";
import {
  BUILDER_PREVIEW_COMPONENT_NAME,
  BUILDER_PREVIEW_TAB_ID,
  registerBuilderPreviewTabComponent,
} from "./BuilderPreviewTab";
import { updateBuilderPreviewBridge } from "./builderPreviewBridge";
import { clearSurveyBuilderDraft, loadSurveyBuilderDraft, saveSurveyBuilderDraft } from "./builderDraft";
import { ThemeBackgroundGallery } from "./ThemeBackgroundGallery";

registerSurveyTheme(SurveyTheme);
registerCreatorTheme(...Object.values(creatorThemes));

type SurveyBuilderProps = {
  canAdministerAllForms?: boolean;
  formId?: string;
  safeEditingResponseCount?: number;
  userId: string;
};

type BuilderSchema = SurveySchema & {
  questionDescriptionLocation?: string;
};

type CreatorToolboxItem = {
  name: string;
  iconName: string;
  title: string;
  category: string;
  json: Record<string, unknown>;
  items?: CreatorToolboxItem[];
};

type PostSaveSettingsState = {
  title: string;
  schema: SurveySchema;
  theme: ITheme;
  assetFormId: string;
  deadlineValue: string;
  responseLimitValue: string;
  formTypeValue: string;
  formReasonValue: string;
  allowResponseEditing: boolean;
  organizationTypes: OrganizationType[];
};

type ExistingFormSaveRequest = {
  allowResponseEditing: boolean;
  callback: (saveNo: number, isSuccess: boolean) => void;
  id: string;
  isTemplate: boolean;
  saveNo: number;
  schema: SurveySchema;
  selectedOrganizationTypes: OrganizationType[];
  theme: ITheme;
  title: string;
};

type CompatibilityDialogState = {
  request: ExistingFormSaveRequest;
  result: SchemaUpdateResult;
};

function OrganizationTypeSettings({
  selectedTypes,
  onChange,
  disabled = false,
  className = "",
}: {
  selectedTypes: OrganizationType[];
  onChange: (types: OrganizationType[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const toggleType = (type: OrganizationType) => {
    const nextTypes = selectedTypes.includes(type)
      ? selectedTypes.filter((item) => item !== type)
      : [...selectedTypes, type];
    if (nextTypes.length > 0) {
      onChange(nextTypes);
    }
  };

  return (
    <fieldset className={`builder-organization-settings ${className}`.trim()}>
      <legend>Организации для выбора:</legend>
      <div className="builder-organization-options">
        {ORGANIZATION_TYPE_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selectedTypes.includes(option.value)}
              onChange={() => toggleType(option.value)}
              disabled={disabled || (selectedTypes.length === 1 && selectedTypes[0] === option.value)}
            />
            <span>{option.selectionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const BUILDER_RUNTIME_PREVIEW_SYNC_DELAY_MS = 75;
const builderDesignerSurveys = new WeakMap<SurveyCreator, Set<{ applyTheme: (theme: ITheme) => void }>>();

function applyThemeToBuilderDesigners(creator: SurveyCreator) {
  const designerTheme = resolveBuilderDesignerTheme(creator.theme);
  builderDesignerSurveys.get(creator)?.forEach((survey) => survey.applyTheme(designerTheme));
}

function enableThemePageTitleFontEditor(creator: SurveyCreator) {
  const pageTitleFontEditor = creator.themeEditor.propertyGrid.survey.getQuestionByName("pageTitle");

  if (pageTitleFontEditor) {
    pageTitleFontEditor.readOnly = false;
  }
}

function configureCreatorLocalization() {
  surveyLocalization.defaultLocale = "ru";
  editorLocalization.currentLocale = "ru";
  const ruEditorStrings = editorLocalization.getLocaleStrings("ru");
  if (ruEditorStrings?.ed) {
    ruEditorStrings.ed.pagePlaceHolder =
      "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
    ruEditorStrings.ed.pagePlaceHolderMobile =
      "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
  }
  if (ruEditorStrings?.tabs) {
    ruEditorStrings.tabs.designer = "\u041a\u043e\u043d\u0441\u0442\u0440\u0443\u043a\u0442\u043e\u0440";
    ruEditorStrings.tabs.preview = "\u041f\u0440\u0435\u0432\u044c\u044e";
    ruEditorStrings.tabs.logic = "\u041b\u043e\u0433\u0438\u043a\u0430 \u0444\u043e\u0440\u043c\u044b";
    ruEditorStrings.tabs.theme = "\u0422\u0435\u043c\u044b";
  }
}

function configureCreatorToolbox(creator: SurveyCreator) {
  const toolbox = creator.toolbox;
  toolbox.showCategoryTitles = true;
  toolbox.clearItems();

  QUESTION_TYPE_DEFINITIONS.forEach((definition, index) => {
    const item: CreatorToolboxItem = {
      name: definition.name,
      iconName: definition.iconName,
      title: definition.title,
      category: definition.category,
      json: { type: definition.name },
    };

    toolbox.addItem(item, index);
  });

  const textItem = toolbox.getItemByName("text") as
    | (ReturnType<typeof toolbox.getItemByName> & { items?: CreatorToolboxItem[]; clearSubitems?: () => void })
    | null;

  textItem?.clearSubitems?.();
  if (textItem) {
    textItem.items = [];
  }

  toolbox.categories.forEach((category) => {
    if (category.name === "basic") {
      category.title = "Базовые";
    }

    if (category.name === "advanced") {
      category.title = "Расширенные";
    }
  });
}

function registerCustomIcons() {
  if (!SvgRegistry || typeof SvgRegistry.registerIconFromSvg !== "function") {
    return;
  }

  const registerSvgIcon = (iconName: string, iconSvg: string) => {
    SvgRegistry.registerIconFromSvg(iconName, iconSvg);
  };

  registerSvgIcon("icon-toolbox-phone-custom", phoneIcon);
  registerSvgIcon("icon-toolbox-email-custom", emailIcon);
  registerSvgIcon("icon-toolbox-float-custom", floatIcon);
  registerSvgIcon("icon-toolbox-integer-custom", integerIcon);
  registerSvgIcon("icon-toolbox-date-custom", dateIcon);
  registerSvgIcon("icon-toolbox-time-custom", timeIcon);
  registerSvgIcon("icon-toolbox-datetime-custom", dateTimeIcon);
  registerSvgIcon("icon-toolbox-sectiontitle-custom", sectionTitleIcon);
}

function configureCreatorQuestionTypes() {
  registerCustomSurveyQuestionTypes();
  [
    ["text", "inputType"],
    ["survey", "showQuestionNumbers"],
    ["survey", "questionStartIndex"],
    ["survey", "questionTitlePattern"],
    ["question", "showNumber"],
    ["question", "hideNumber"],
    ["panel", "showNumber"],
    ["panel", "showQuestionNumbers"],
    ["paneldynamic", "showNumber"],
    ["paneldynamic", "showQuestionNumbers"],
  ].forEach(([typeName, propertyName]) => {
    const property = Serializer.getProperty(typeName, propertyName);
    if (property) {
      property.visible = false;
    }
  });
}

function createCreatorInstance(
  formId: string | undefined,
  creatorTheme: ICreatorTheme,
  safeEditingMode: boolean,
) {
  configureCreatorLocalization();
  registerCustomIcons();
  configureCreatorQuestionTypes();
  const patchedDesignerSurveys = new WeakSet<object>();
  const designerSurveys = new Set<{ applyTheme: (theme: ITheme) => void }>();

  const creator = new SurveyCreator({
    questionTypes: [...QUESTION_TYPES],
    showDesignerTab: true,
    showLogicTab: true,
    showPreviewTab: false,
    showJSONEditorTab: false,
    showTranslationTab: false,
    showThemeTab: true,
    showSaveButton: true,
    isAutoSave: false,
    showAddQuestionButton: false,
    showSurveyHeader: true,
    propertyGridNavigationMode: "accordion",
    showCreatorThemeSettings: false,
    previewAllowSimulateDevices: true,
    previewAllowSelectLanguage: false,
    previewAllowHiddenElements: false,
    previewAllowSelectPage: true,
    useElementTitles: true,
  });

  creator.locale = "ru";
  creator.applyCreatorTheme(creatorTheme);
  creator.onSurveyInstanceCreated.add((_sender, options) => {
    if (options.area === "designer-tab" && !patchedDesignerSurveys.has(options.survey)) {
      patchedDesignerSurveys.add(options.survey);
      designerSurveys.add(options.survey);
      options.survey.applyTheme(resolveBuilderDesignerTheme(creator.theme));
    }
  });
  builderDesignerSurveys.set(creator, designerSurveys);
  creator.theme = resolveSurveyTheme(DEFAULT_SURVEY_THEME);
  creator.JSON = resolveDefaultSurveyLogo(createEmptyBuilderSchema());
  creator.allowCollapseSidebar = true;
  creator.showSidebar = true;

  configureCreatorToolbox(creator);
  registerBuilderPreviewTab(creator, formId);

  creator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      const questionType = (options.question as { getType?: () => string }).getType?.();
      options.question.isRequired = questionType !== "sectiontitle" && questionType !== "expression" && !safeEditingMode;
      options.question.descriptionLocation = "underTitle";
      (options.question as { showNumber?: boolean }).showNumber = false;
      if (questionType === "panel" || questionType === "paneldynamic") {
        (options.question as { showQuestionNumbers?: string }).showQuestionNumbers = "off";
      }
    }
  });

  creator.onElementAllowOperations.add((_sender, options) => {
    const currentType = options.obj?.getType?.();

    options.allowChangeInputType = false;
    if (currentType === "sectiontitle") options.allowChangeRequired = false;
    if (!currentType) {
      return;
    }

    options.allowChangeType = QUESTION_TYPES.includes(currentType as SurveyQuestionType);
  });

  creator.onPropertyGetReadOnly.add((_sender, options) => {
    const propertyName = options.property?.name;
    const elementType = options.element?.getType?.();
    if (propertyName === "name" && elementType !== "survey") {
      options.readOnly = true;
    }
  });

  creator.onPropertyShowing.add((_sender, options) => {
    if (options.element?.getType?.() === "sectiontitle" && options.property.name === "isRequired") {
      options.show = false;
    }
  });

  return creator;
}

function cloneSchema(schema: SurveySchema): SurveySchema {
  return sanitizeSurveySchema(schema);
}

function getSerializedBuilderSchema(creator: SurveyCreator): SurveySchema {
  return normalizeSurveyQuestionNumbers(
    serializeDefaultSurveyLogo(creator.JSON as SurveySchema),
  );
}

function getRuntimePreviewSchema(creator: SurveyCreator): SurveySchema {
  return getSerializedBuilderSchema(creator);
}

function updateRuntimePreviewBridgeFromCreator(creator: SurveyCreator, formId?: string) {
  updateBuilderPreviewBridge({
    previewSchema: getRuntimePreviewSchema(creator),
    previewTheme: sanitizeSurveyTheme(creator.theme),
    formId,
  });
}

function applyThemeToCreatorAndEditor(creator: SurveyCreator, theme: ITheme) {
  creator.theme = theme;
  creator.themeEditor.themeModel.setTheme(theme);
}

function registerBuilderPreviewTab(creator: SurveyCreator, formId?: string) {
  registerBuilderPreviewTabComponent();

  const syncPreview = () => {
    updateRuntimePreviewBridgeFromCreator(creator, formId);
  };
  const runtimePreviewPlugin: ICreatorPlugin = {
    model: creator,
    activate: syncPreview,
    update: syncPreview,
    deactivate: () => true,
  };

  creator.addPluginTab(
    BUILDER_PREVIEW_TAB_ID,
    runtimePreviewPlugin,
    "Превью",
    BUILDER_PREVIEW_COMPONENT_NAME,
    1,
  );
}

function getSchemaTitle(schema: SurveySchema, fallbackTitle: string) {
  const normalizedTitle = schema.title?.trim();
  return normalizedTitle || fallbackTitle;
}

function toBuilderSchema(schema: SurveySchema, fallbackTitle: string): BuilderSchema {
  const builderSchema = normalizeSurveyQuestionNumbers(cloneSchema(schema)) as BuilderSchema;

  return {
    ...builderSchema,
    title: getSchemaTitle(builderSchema, fallbackTitle),
    locale: builderSchema.locale ?? "ru",
    questionDescriptionLocation: builderSchema.questionDescriptionLocation ?? "underTitle",
  };
}

function createEmptyBuilderSchema(title = "Новая форма") {
  return toBuilderSchema(createEmptySurveySchema(title), title);
}

const GUARDED_COLLECTION_PROPERTIES = ["choices", "rows", "columns", "rateValues", "items"] as const;

function getProtectedCollectionItemIdentity(propertyName: string, item: unknown) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const itemRecord = item as Record<string, unknown>;
    const technicalValue = (
      (propertyName === "items" || propertyName === "columns")
      && itemRecord.name !== undefined
      && itemRecord.value === undefined
    )
      ? itemRecord.name
      : itemRecord.value;
    if (technicalValue !== undefined) {
      return JSON.stringify(technicalValue);
    }
  }

  return JSON.stringify(item);
}

function collectOriginalSchemaProtection(schema: SurveySchema) {
  const questionNames = new Set<string>();
  const collectionItems = new Set<string>();
  const stack: unknown[] = schema.pages.flatMap((page) => page.elements);

  while (stack.length > 0) {
    const element = stack.pop();
    if (!element || typeof element !== "object" || Array.isArray(element)) continue;
    const elementRecord = element as Record<string, unknown>;
    const name = typeof elementRecord.name === "string" ? elementRecord.name : "";

    if (name) {
      questionNames.add(name);
      GUARDED_COLLECTION_PROPERTIES.forEach((propertyName) => {
        const items = elementRecord[propertyName];
        if (!Array.isArray(items)) return;
        items.forEach((item) => {
          collectionItems.add(`${name}:${propertyName}:${getProtectedCollectionItemIdentity(propertyName, item)}`);
        });
      });
    }

    for (const propertyName of ["elements", "templateElements"]) {
      const nestedElements = elementRecord[propertyName];
      if (Array.isArray(nestedElements)) stack.push(...nestedElements);
    }
  }

  return { questionNames, collectionItems };
}

export function SurveyBuilder({
  canAdministerAllForms = false,
  formId,
  safeEditingResponseCount = 0,
  userId,
}: SurveyBuilderProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
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
      confirmWarnings = false,
    }: {
      id: string;
      schema: SurveySchema;
      theme: ITheme;
      title: string;
      allowResponseEditing: boolean;
      selectedOrganizationTypes: OrganizationType[];
      confirmWarnings?: boolean;
    }) => confirmWarnings
      ? saveSurveySchema(
          id,
          schema,
          theme,
          title,
          allowResponseEditing,
          selectedOrganizationTypes,
          true,
        )
      : saveSurveySchema(
          id,
          schema,
          theme,
          title,
          allowResponseEditing,
          selectedOrganizationTypes,
        ),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);
  const isSafeEditingMode = isEditMode && safeEditingResponseCount > 0;
  const isSurveyMutationBusy = isSaving || saveSurveyMutation.isPending || createSurveyMutation.isPending;
  const isTemplateBusy = isTemplateActionLoading !== null;
  const saveTemplateHandlerRef = useRef<() => void>(() => undefined);
  const draftHydrationStateRef = useRef<"idle" | "loaded" | "empty">("idle");
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
    data: editableForm,
    isLoading: isEditableFormLoading,
    error: editableFormError,
  } = useQuery({
    queryKey: getFormQueryKey(formId),
    queryFn: async ({ signal }) => {
      const form = await getFormById(formId ?? "", { signal });
      if (form && form.author_id !== userId && !canAdministerAllForms) {
        throw new Error("У вас нет прав на редактирование этой формы");
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

  useEffect(() => {
    assetFormIdRef.current = formId ?? createSurveyAssetFormId();
    const nextCreator = createCreatorInstance(formId, creatorThemeRef.current, isSafeEditingMode);
    setCreator(nextCreator);
    setOrganizationTypes([...DEFAULT_FORM_ORGANIZATION_TYPES]);
    draftHydrationStateRef.current = "idle";
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
  }, [clearScheduledRuntimePreviewSync, formId, isSafeEditingMode]);

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
      if (!formId && restoredDraft.assetFormId) assetFormIdRef.current = restoredDraft.assetFormId;
      creator.locale = restoredDraft.schema.locale ?? "ru";
      creator.theme = resolveSurveyTheme(restoredDraft.theme);
      applyThemeToBuilderDesigners(creator);
      creator.JSON = resolveDefaultSurveyLogo(toBuilderSchema(restoredDraft.schema, "Новая форма"));
      syncRuntimePreviewNow(creator);
      return;
    }

    draftHydrationStateRef.current = "empty";
    syncRuntimePreviewNow(creator);
  }, [creator, formId, syncRuntimePreviewNow, userId]);

  useEffect(() => {
    if (!creator || !editableForm || draftHydrationStateRef.current === "loaded") {
      return;
    }

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
    syncRuntimePreviewNow(creator);
  }, [creator, editableForm, syncRuntimePreviewNow]);

  useEffect(() => {
    setResponseEditingEnabled(editableForm?.allow_response_editing ?? false);
  }, [editableForm?.allow_response_editing, formId]);

  useEffect(() => {
    setOrganizationTypes(normalizeOrganizationTypes(editableForm?.organization_types));
  }, [editableForm?.organization_types, formId]);

  useEffect(() => {
    if (!creator || !editableForm || !isSafeEditingMode) {
      return;
    }

    const protection = collectOriginalSchemaProtection(editableForm.schema);
    const handleElementOperations = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        allowChangeInputType?: boolean;
        allowChangeType?: boolean;
        allowDelete?: boolean;
        allowDrag?: boolean;
        allowEdit?: boolean;
        element?: { name?: string };
        obj?: { name?: string };
      };
      const elementName = options.element?.name ?? options.obj?.name;
      if (!elementName || !protection.questionNames.has(elementName)) return;

      options.allowDelete = false;
      options.allowChangeType = false;
      options.allowChangeInputType = false;
      options.allowDrag = true;
      options.allowEdit = true;
    };
    const handleCollectionOperations = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        allowDelete?: boolean;
        element?: { name?: string };
        item?: unknown;
        propertyName?: string;
      };
      const questionName = options.element?.name;
      const propertyName = options.propertyName;
      if (!questionName || !propertyName || !GUARDED_COLLECTION_PROPERTIES.includes(
        propertyName as (typeof GUARDED_COLLECTION_PROPERTIES)[number],
      )) {
        return;
      }

      const key = `${questionName}:${propertyName}:${getProtectedCollectionItemIdentity(propertyName, options.item)}`;
      if (protection.collectionItems.has(key)) {
        options.allowDelete = false;
      }
    };
    const handleReadOnlyProperty = (_sender: unknown, rawOptions: unknown) => {
      const options = rawOptions as {
        element?: unknown;
        parentElement?: { name?: string };
        parentProperty?: { name?: string };
        property?: { name?: string };
        readOnly?: boolean;
      };
      const questionName = options.parentElement?.name;
      const collectionName = options.parentProperty?.name;
      const itemRecord = options.element && typeof options.element === "object" && !Array.isArray(options.element)
        ? options.element as Record<string, unknown>
        : {};
      const technicalPropertyName = (
        (collectionName === "items" || collectionName === "columns")
        && itemRecord.name !== undefined
        && itemRecord.value === undefined
      )
        ? "name"
        : "value";
      if (
        !questionName
        || !collectionName
        || options.property?.name !== technicalPropertyName
        || !GUARDED_COLLECTION_PROPERTIES.includes(
          collectionName as (typeof GUARDED_COLLECTION_PROPERTIES)[number],
        )
      ) {
        return;
      }

      const key = `${questionName}:${collectionName}:${getProtectedCollectionItemIdentity(collectionName, options.element)}`;
      if (protection.collectionItems.has(key)) {
        options.readOnly = true;
      }
    };

    creator.onElementAllowOperations.add(handleElementOperations);
    creator.onCollectionItemAllowOperations.add(handleCollectionOperations);
    creator.onPropertyGetReadOnly.add(handleReadOnlyProperty);

    return () => {
      creator.onElementAllowOperations.remove(handleElementOperations);
      creator.onCollectionItemAllowOperations.remove(handleCollectionOperations);
      creator.onPropertyGetReadOnly.remove(handleReadOnlyProperty);
    };
  }, [creator, editableForm, isSafeEditingMode]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const handleModified = () => {
      saveSurveyBuilderDraft(
        userId,
        formId,
        getSerializedBuilderSchema(creator),
        sanitizeSurveyTheme(creator.theme),
        assetFormIdRef.current,
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
    saveSurveyBuilderDraft(userId, formId, emptySchema, creator.theme, assetFormIdRef.current);
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
        showTitle: true,
        css: "builder-toolbar-action-item",
        innerCss: "builder-toolbar-action-button",
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
      resetAction.innerCss = "builder-toolbar-action-button";
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
          const request: ExistingFormSaveRequest = {
            allowResponseEditing: responseEditingEnabled,
            callback,
            id: formId,
            isTemplate,
            saveNo,
            schema,
            selectedOrganizationTypes: organizationTypes,
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
    );
    syncRuntimePreviewNow(creator);
  }, [creator, formId, syncRuntimePreviewNow, userId]);

  const handleBackgroundGalleryError = useCallback((message: string) => {
    showToast(message, "error");
  }, [showToast]);

  return (
    <div className="builder-host">
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

      {isBackgroundGalleryOpen && creator && (
        <ThemeBackgroundGallery
          currentBackground={galleryBackground}
          formId={assetFormIdRef.current}
          ownerId={editableForm?.author_id ?? userId}
          onApply={handleApplyBackground}
          onClose={() => setIsBackgroundGalleryOpen(false)}
          onError={handleBackgroundGalleryError}
        />
      )}

      {isResetConfirmOpen && (
        <div className="modal-backdrop">
          <div className="modal-card card builder-reset-modal">
            <h3 className="builder-reset-title">Сбросить конструктор?</h3>
            <p className="builder-template-subtitle">
              Все несохранённые вопросы и поля будут очищены. Это действие нельзя отменить.
            </p>
            <div className="deadline-modal-actions">
              <button
                type="button"
                className="deadline-action-cancel-button"
                onClick={() => setIsResetConfirmOpen(false)}
                disabled={isSurveyMutationBusy || isTemplateBusy}
              >
                Отмена
              </button>
              <button
                type="button"
                className="deadline-clear-button"
                onClick={handleResetBuilder}
                disabled={isSurveyMutationBusy || isTemplateBusy}
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      )}

      {compatibilityDialog && (
        <div className="modal-backdrop">
          <div
            className="modal-card card builder-compatibility-modal"
            role="dialog"
            aria-modal="true"
            aria-label={compatibilityDialog.result.status === "blocked"
              ? "Несовместимые изменения формы"
              : "Предупреждение об изменениях формы"}
          >
            <h3 className="builder-reset-title">
              {compatibilityDialog.result.status === "blocked"
                ? "Некоторые изменения несовместимы с полученными ответами"
                : "Подтвердите изменения формы"}
            </h3>
            <p className="builder-template-subtitle">
              {compatibilityDialog.result.status === "blocked"
                ? "Эти изменения нельзя сохранить в текущей форме. Создайте копию, чтобы продолжить без риска для ответов."
                : "Изменения будут применяться только к новым ответам. Ранее полученные ответы останутся без новых значений."}
            </p>
            <ul className="builder-compatibility-list">
              {(compatibilityDialog.result.status === "blocked"
                ? compatibilityDialog.result.breakingChanges
                : compatibilityDialog.result.warnings
              ).map((message) => <li key={message}>{message}</li>)}
            </ul>
            <div className="deadline-modal-actions">
              {compatibilityDialog.result.status === "blocked" ? (
                <>
                  <button
                    type="button"
                    className="deadline-save-button"
                    onClick={() => void handleCreateCompatibilityCopy()}
                    disabled={isCompatibilityCopying}
                  >
                    {isCompatibilityCopying && <InlineSpinner />}
                    Создать копию
                  </button>
                  <button
                    type="button"
                    className="deadline-action-cancel-button"
                    onClick={handleCloseCompatibilityDialog}
                    disabled={isCompatibilityCopying}
                  >
                    Вернуться к форме
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="deadline-save-button"
                    onClick={() => void handleConfirmCompatibilityWarnings()}
                    disabled={isSaving}
                  >
                    {isSaving && <InlineSpinner />}
                    Сохранить изменения
                  </button>
                  <button
                    type="button"
                    className="deadline-action-cancel-button"
                    onClick={handleCloseCompatibilityDialog}
                    disabled={isSaving}
                  >
                    Отмена
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {postSaveSettings && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal" role="dialog" aria-modal="true" aria-label="Настройки формы">
            <h3 className="deadline-modal-title">Настройки формы</h3>
            <p className="deadline-modal-subtitle">{postSaveSettings.title}</p>
            <div className="deadline-modal-primary-grid">
              <label className="deadline-field">
                <span>
                  Тип формы <span className="deadline-required-mark" aria-hidden="true">*</span>
                </span>
                <div className="deadline-select-shell">
                  <select
                    aria-label="Тип формы"
                    value={postSaveSettings.formTypeValue}
                    onChange={(event) =>
                      setPostSaveSettings((current) =>
                        current ? { ...current, formTypeValue: event.target.value } : current,
                      )
                    }
                  >
                    <option value="" disabled hidden />
                    {REGULAR_FORM_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!postSaveSettings.formTypeValue && (
                    <span className="deadline-select-placeholder" aria-hidden="true">
                      Выберите тип
                    </span>
                  )}
                </div>
              </label>
              <label className="deadline-field">
                <span>
                  Основание формы <span className="deadline-required-mark" aria-hidden="true">*</span>
                </span>
                <div className="deadline-select-shell">
                  <select
                    aria-label="Основание формы"
                    value={postSaveSettings.formReasonValue}
                    onChange={(event) =>
                      setPostSaveSettings((current) =>
                        current ? { ...current, formReasonValue: event.target.value } : current,
                      )
                    }
                  >
                    <option value="" disabled hidden />
                    {FORM_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!postSaveSettings.formReasonValue && (
                    <span className="deadline-select-placeholder" aria-hidden="true">
                      Выберите основание
                    </span>
                  )}
                </div>
              </label>
            </div>
            <label className="deadline-field">
              <span>Дедлайн</span>
              <input
                type="datetime-local"
                value={postSaveSettings.deadlineValue}
                onChange={(event) =>
                  setPostSaveSettings((current) =>
                    current ? { ...current, deadlineValue: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="deadline-field">
              <span>Лимит ответов</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={postSaveSettings.responseLimitValue}
                onChange={(event) =>
                  setPostSaveSettings((current) =>
                    current ? { ...current, responseLimitValue: event.target.value } : current,
                  )
                }
              />
            </label>
            <div className="builder-response-settings builder-response-settings-modal">
              <div>
                <strong>Редактирование ответов</strong>
                <span>Разрешить респонденту менять уже отправленный ответ.</span>
              </div>
              <button
                type="button"
                className={`settings-toggle ${postSaveSettings.allowResponseEditing ? "settings-toggle-active" : ""}`.trim()}
                role="switch"
                aria-checked={postSaveSettings.allowResponseEditing}
                aria-label="Редактирование ответов"
                onClick={() => setPostSaveSettings((current) => current ? {
                  ...current,
                  allowResponseEditing: !current.allowResponseEditing,
                } : current)}
                disabled={isPostSaveSettingsSaving}
              >
                <span aria-hidden="true" />
              </button>
            </div>
            {hasOrganizationQuestion(postSaveSettings.schema) && (
              <OrganizationTypeSettings
                className="builder-organization-settings-modal"
                selectedTypes={postSaveSettings.organizationTypes}
                onChange={(types) => setPostSaveSettings((current) => current ? {
                  ...current,
                  organizationTypes: types,
                } : current)}
                disabled={isPostSaveSettingsSaving}
              />
            )}
            <p className="deadline-modal-hint">
              Дедлайн и лимит ответов можно оставить пустыми.
            </p>
            <div className="deadline-modal-actions">
              <button type="button" className="deadline-clear-button" onClick={closePostSaveSettings} disabled={isPostSaveSettingsSaving}>
                Отмена
              </button>
              <button type="button" className="deadline-save-button" onClick={() => void handleSavePostSaveSettings()} disabled={isPostSaveSettingsSaving}>
                {isPostSaveSettingsSaving && <InlineSpinner />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

