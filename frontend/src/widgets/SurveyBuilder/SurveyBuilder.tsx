import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { editorLocalization } from "survey-creator-core";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import { ComponentCollection, Serializer, SvgRegistry, surveyLocalization, type ITheme } from "survey-core";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";
import phoneIcon from "../../img/constructor/Phone.svg?raw";
import emailIcon from "../../img/constructor/Email.svg?raw";
import floatIcon from "../../img/constructor/float.svg?raw";
import integerIcon from "../../img/constructor/integer.svg?raw";
import dateIcon from "../../img/constructor/Date.svg?raw";
import timeIcon from "../../img/constructor/Time.svg?raw";
import dateTimeIcon from "../../img/constructor/Date-Time.svg?raw";

import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import {
  getFormById,
  saveSurveySchema,
  setFormDeadline,
  setFormResponseLimit,
} from "../../entities/survey/api/surveysApi";
import {
  resolveDefaultSurveyLogo,
  serializeDefaultSurveyLogo,
} from "../../entities/survey/model/defaultSurveyLogo";
import { TEMPLATE_FORM_TYPE, createEmptySurveySchema, isTemplateForm } from "../../entities/survey/model/surveyModel";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import type { SurveySchema } from "../../entities/survey/types";
import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { getErrorMessage } from "../../shared/lib/error";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { clearSurveyBuilderDraft, loadSurveyBuilderDraft, saveSurveyBuilderDraft } from "./builderDraft";

type SurveyBuilderProps = {
  formId?: string;
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
  formId: string;
  title: string;
  deadlineValue: string;
  responseLimitValue: string;
};

const QUESTION_TYPES = [
  "text",
  "comment",
  "radiogroup",
  "checkbox",
  "dropdown",
  "number",
  "integer",
  "date",
  "time",
  "datetime",
  "phone",
  "email",
  "boolean",
  "rating",
  "ranking",
  "tagbox",
  "matrix",
  "matrixdropdown",
  "matrixdynamic",
  "multipletext",
  "image",
  "imagepicker",
  "file",
  "signaturepad",
  "panel",
  "paneldynamic",
  "expression",
  "html",
] as const;

type CreatorQuestionType = (typeof QUESTION_TYPES)[number];

type QuestionTypeDefinition = {
  name: CreatorQuestionType;
  iconName: string;
  title: string;
  category: "basic" | "advanced";
  questionJSON?: Record<string, unknown>;
};

const QUESTION_TYPE_DEFINITIONS: QuestionTypeDefinition[] = [
  {
    name: "text",
    iconName: "icon-text",
    title: "Текст",
    category: "basic",
  },
  {
    name: "comment",
    iconName: "icon-comment",
    title: "Абзац",
    category: "basic",
  },
  {
    name: "radiogroup",
    iconName: "icon-radiogroup",
    title: "Единичный выбор",
    category: "basic",
  },
  {
    name: "checkbox",
    iconName: "icon-checkbox",
    title: "Множественный выбор",
    category: "basic",
  },
  {
    name: "dropdown",
    iconName: "icon-dropdown",
    title: "Выпадающий список",
    category: "basic",
  },
  {
    name: "number",
    iconName: "icon-toolbox-float-custom",
    title: "Число",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "number",
      step: "any",
      titleLocation: "top",
    },
  },
  {
    name: "integer",
    iconName: "icon-toolbox-integer-custom",
    title: "Целое число",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "number",
      step: 1,
      titleLocation: "top",
      validators: [
        {
          type: "regex",
          regex: "^-?\\d+$",
          text: "Введите целое число без точки и запятой",
        },
      ],
    },
  },
  {
    name: "date",
    iconName: "icon-toolbox-date-custom",
    title: "Дата",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "date",
      titleLocation: "top",
    },
  },
  {
    name: "time",
    iconName: "icon-toolbox-time-custom",
    title: "Время",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "time",
      titleLocation: "top",
    },
  },
  {
    name: "datetime",
    iconName: "icon-toolbox-datetime-custom",
    title: "Дата и время",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "datetime-local",
      titleLocation: "top",
    },
  },
  {
    name: "phone",
    iconName: "icon-toolbox-phone-custom",
    title: "Телефон",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "tel",
      maskType: "pattern",
      maskSettings: {
        pattern: "+7(999)-999-99-99",
        saveMaskedValue: true,
      },
      placeholder: "+7(999)-999-99-99",
      titleLocation: "top",
      validators: [
        {
          type: "regex",
          regex: "^\\+7\\(\\d{3}\\)-\\d{3}-\\d{2}-\\d{2}$",
          text: "Введите телефон в формате +7(999)-999-99-99",
        },
      ],
    },
  },
  {
    name: "email",
    iconName: "icon-toolbox-email-custom",
    title: "Email",
    category: "basic",
    questionJSON: {
      type: "text",
      inputType: "email",
      titleLocation: "top",
    },
  },
  {
    name: "boolean",
    iconName: "icon-boolean",
    title: "Да/Нет",
    category: "advanced",
  },
  {
    name: "rating",
    iconName: "icon-rating",
    title: "Рейтинг",
    category: "advanced",
  },
  {
    name: "ranking",
    iconName: "icon-ranking",
    title: "Ранжирование",
    category: "advanced",
  },
  {
    name: "tagbox",
    iconName: "icon-tagbox",
    title: "Теги",
    category: "advanced",
  },
  {
    name: "matrix",
    iconName: "icon-matrix",
    title: "Матрица",
    category: "advanced",
  },
  {
    name: "matrixdropdown",
    iconName: "icon-matrixdropdown",
    title: "Матрица с выбором",
    category: "advanced",
  },
  {
    name: "matrixdynamic",
    iconName: "icon-matrixdynamic",
    title: "Динамическая матрица",
    category: "advanced",
  },
  {
    name: "multipletext",
    iconName: "icon-multipletext",
    title: "Несколько полей",
    category: "advanced",
  },
  {
    name: "image",
    iconName: "icon-image",
    title: "Изображение",
    category: "advanced",
  },
  {
    name: "imagepicker",
    iconName: "icon-imagepicker",
    title: "Выбор изображения",
    category: "advanced",
  },
  {
    name: "file",
    iconName: "icon-file",
    title: "Файл",
    category: "advanced",
  },
  {
    name: "signaturepad",
    iconName: "icon-signaturepad",
    title: "Подпись",
    category: "advanced",
  },
  {
    name: "panel",
    iconName: "icon-panel",
    title: "Панель",
    category: "advanced",
  },
  {
    name: "paneldynamic",
    iconName: "icon-paneldynamic",
    title: "Динамическая панель",
    category: "advanced",
  },
  {
    name: "expression",
    iconName: "icon-expression",
    title: "Выражение",
    category: "advanced",
  },
  {
    name: "html",
    iconName: "icon-html",
    title: "HTML",
    category: "advanced",
  },
];

const CREATOR_SURVEY_THEME: ITheme = {
  themeName: "defaultV2",
  cssVariables: {
    "--sjs-primary-backcolor": "#121212",
    "--sjs-primary-backcolor-dark": "#000000",
    "--sjs-primary-backcolor-light": "rgba(18, 18, 18, 0.12)",
    "--sjs-primary-background-500": "#121212",
    "--sjs-primary-background-400": "#232323",
    "--sjs-primary-background-10": "rgba(18, 18, 18, 0.08)",
    "--sjs-primary-forecolor": "#ffffff",
    "--sjs-header-backcolor": "#121212",
    "--sjs-general-backcolor": "#fffdf9",
    "--sjs-general-backcolor-dim": "#f2eee8",
    "--sjs-general-backcolor-dim-light": "#f8f5f0",
    "--sjs-general-backcolor-dark": "#dfd9d1",
    "--sjs-general-forecolor": "#181818",
    "--sjs-general-forecolor-light": "#5f5a54",
    "--sjs-layer-1-foreground-100": "#181818",
    "--sjs-layer-1-foreground-50": "#5f5a54",
    "--sjs-layer-1-background-500": "#fffdf9",
    "--sjs-layer-3-background-500": "#f2eee8",
  },
};

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
}

function registerCustomQuestionTypes() {
  QUESTION_TYPE_DEFINITIONS.filter((definition) => definition.questionJSON).forEach((definition) => {
    if (ComponentCollection.Instance.getCustomQuestionByName(definition.name)) {
      return;
    }

    ComponentCollection.Instance.add({
      name: definition.name,
      title: definition.title,
      iconName: definition.iconName,
      questionJSON: definition.questionJSON,
      inheritBaseProps: true,
    });
  });

  const inputTypeProperty = Serializer.getProperty("text", "inputType");
  if (inputTypeProperty) {
    inputTypeProperty.visible = false;
  }
}

function createCreatorInstance() {
  configureCreatorLocalization();
  registerCustomIcons();
  registerCustomQuestionTypes();
  const patchedDesignerSurveys = new WeakSet<object>();

  const creator = new SurveyCreator({
    questionTypes: [...QUESTION_TYPES],
    showLogicTab: true,
    showPreviewTab: true,
    showJSONEditorTab: false,
    showSaveButton: true,
    isAutoSave: false,
    showAddQuestionButton: false,
  });

  creator.locale = "ru";
  creator.onSurveyInstanceCreated.add((_sender, options) => {
    if (options.area === "preview-tab" || options.area === "designer-tab") {
      options.survey.applyTheme(CREATOR_SURVEY_THEME);
    }

    if (options.area === "designer-tab" && !patchedDesignerSurveys.has(options.survey)) {
      patchedDesignerSurveys.add(options.survey);

      options.survey.onPageAdded.add((_survey, pageOptions) => {
        clearAutoPageTitle(pageOptions.page);
      });
    }
  });
  creator.JSON = resolveDefaultSurveyLogo(createEmptyBuilderSchema());
  creator.allowCollapseSidebar = true;
  creator.showSidebar = false;

  configureCreatorToolbox(creator);

  creator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      options.question.isRequired = true;
      options.question.descriptionLocation = "underTitle";
    }
  });

  creator.onElementAllowOperations.add((_sender, options) => {
    const currentType = options.obj?.getType?.();

    options.allowChangeInputType = false;
    if (!currentType) {
      return;
    }

    options.allowChangeType = QUESTION_TYPES.includes(currentType as CreatorQuestionType);
  });

  return creator;
}

function cloneSchema(schema: SurveySchema): SurveySchema {
  return JSON.parse(JSON.stringify(schema)) as SurveySchema;
}

function getSchemaTitle(schema: SurveySchema, fallbackTitle: string) {
  const normalizedTitle = schema.title?.trim();
  return normalizedTitle || fallbackTitle;
}

function formatDateTimeLocalValue(dateTime: string | null) {
  if (!dateTime) {
    return "";
  }

  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetInMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetInMs).toISOString().slice(0, 16);
}

function toBuilderSchema(schema: SurveySchema, fallbackTitle: string): BuilderSchema {
  const builderSchema = cloneSchema(schema) as BuilderSchema;

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

function clearAutoPageTitle(page?: { title?: string; name?: string }) {
  if (!page) {
    return;
  }

  const normalizedTitle = (page.title ?? "").trim();
  const pageName = (page.name ?? "").trim();

  if (
    normalizedTitle === "" ||
    normalizedTitle === pageName ||
    /^Страница\s+\d+$/u.test(normalizedTitle) ||
    /^Page\s+\d+$/u.test(normalizedTitle)
  ) {
    page.title = "";
  }
}

export function SurveyBuilder({ formId }: SurveyBuilderProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  const [isTemplateActionLoading, setIsTemplateActionLoading] = useState<"save" | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [postSaveSettings, setPostSaveSettings] = useState<PostSaveSettingsState | null>(null);
  const [isPostSaveSettingsSaving, setIsPostSaveSettingsSaving] = useState(false);
  const { showToast } = useToast();
  const createSurveyMutation = useCreateSurveyMutation();
  const saveSurveyMutation = useMutation({
    mutationFn: ({ id, schema, title }: { id: string; schema: SurveySchema; title: string }) =>
      saveSurveySchema(id, schema, title),
  });
  const deadlineMutation = useMutation({
    mutationFn: ({ id, deadlineAt }: { id: string; deadlineAt: string | null }) => setFormDeadline(id, deadlineAt),
  });
  const responseLimitMutation = useMutation({
    mutationFn: ({ id, maxResponses }: { id: string; maxResponses: number | null }) =>
      setFormResponseLimit(id, maxResponses),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);
  const isSurveyMutationBusy = isSaving || saveSurveyMutation.isPending || createSurveyMutation.isPending;
  const isTemplateBusy = isTemplateActionLoading !== null;
  const saveTemplateHandlerRef = useRef<() => void>(() => undefined);
  const draftHydrationStateRef = useRef<"idle" | "loaded" | "empty">("idle");

  const {
    data: editableForm,
    isLoading: isEditableFormLoading,
    error: editableFormError,
  } = useQuery({
    queryKey: ["form", formId],
    queryFn: () => getFormById(formId ?? ""),
    enabled: isEditMode,
  });

  useEffect(() => {
    const nextCreator = createCreatorInstance();
    setCreator(nextCreator);
    draftHydrationStateRef.current = "idle";

    return () => {
      nextCreator.dispose();
    };
  }, []);

  useEffect(() => {
    draftHydrationStateRef.current = "idle";
  }, [formId]);

  useEffect(() => {
    if (!editableFormError) {
      return;
    }

    showToast(getErrorMessage(editableFormError, "Не удалось загрузить форму"), "error");
  }, [editableFormError, showToast]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const restoredDraft = loadSurveyBuilderDraft(formId);

    if (restoredDraft) {
      draftHydrationStateRef.current = "loaded";
      creator.locale = restoredDraft.locale ?? "ru";
      creator.JSON = resolveDefaultSurveyLogo(toBuilderSchema(restoredDraft, "Новая форма"));
      return;
    }

    draftHydrationStateRef.current = "empty";
  }, [creator, formId]);

  useEffect(() => {
    if (!creator || !editableForm || draftHydrationStateRef.current === "loaded") {
      return;
    }

    creator.locale = editableForm.schema.locale ?? "ru";
    creator.JSON = resolveDefaultSurveyLogo(
      toBuilderSchema(
        {
          ...editableForm.schema,
          title: editableForm.title,
        },
        editableForm.title,
      ),
    );
  }, [creator, editableForm]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const handleModified = () => {
      saveSurveyBuilderDraft(
        formId,
        serializeDefaultSurveyLogo(cloneSchema(creator.JSON as SurveySchema)),
      );
    };

    creator.onModified.add(handleModified);

    return () => {
      creator.onModified.remove(handleModified);
    };
  }, [creator, formId]);

  const scheduleBuilderQueryRefresh = (affectedFormId?: string) => {
    const targets = [
      { queryKey: ["forms"] },
      { queryKey: ["builder-templates"] },
    ];

    if (affectedFormId) {
      targets.push(
        { queryKey: ["form", affectedFormId] },
        { queryKey: ["survey-form", affectedFormId] },
      );
    }

    scheduleQueryInvalidation(queryClient, affectedFormId ? `builder refresh ${affectedFormId}` : "builder refresh", targets);
  };

  const handleSaveAsTemplate = async () => {
    if (!creator) {
      return;
    }

    setIsTemplateActionLoading("save");
    const stopPendingLogger = createPendingStateLogger(queryClient, "builder save template");

    try {
      const schema = serializeDefaultSurveyLogo(cloneSchema(creator.JSON as SurveySchema));
      if (!validateSurveySchema(schema)) {
        throw new Error("Некорректная JSON-схема формы");
      }

      const title = getSchemaTitle(schema, editableForm?.title ?? "Новый шаблон");

      await createSurveyMutation.mutateAsync({
        schema,
        title,
        formType: TEMPLATE_FORM_TYPE,
        isPublic: false,
      });

      scheduleBuilderQueryRefresh();
      showToast("Шаблон сохранён", "success");
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

    const emptySchema = createEmptyBuilderSchema();
    creator.locale = emptySchema.locale ?? "ru";
    creator.JSON = resolveDefaultSurveyLogo(emptySchema);
    saveSurveyBuilderDraft(formId, emptySchema);
    draftHydrationStateRef.current = "loaded";
    setIsResetConfirmOpen(false);
    showToast("Конструктор очищен", "success");
  };

  useEffect(() => {
    if (!creator) {
      return;
    }

    creator.toolbar.addAction(
      {
        id: "builder-reset",
        title: "Сбросить",
        showTitle: true,
        disableShrink: true,
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
        disableShrink: true,
        css: "builder-toolbar-action-item",
        innerCss: "builder-toolbar-action-button",
        action: () => {
          saveTemplateHandlerRef.current();
        },
      },
      true,
    );

    const resetAction = creator.toolbar.getActionById("builder-reset");
    const saveTemplateAction = creator.toolbar.getActionById("builder-save-template");

    if (resetAction) {
      resetAction.visibleIndex = 9;
    }

    if (saveTemplateAction) {
      saveTemplateAction.visibleIndex = 10;
    }

    return () => {
      creator.toolbar.actions = creator.toolbar.actions.filter(
        (action) =>
          action.id !== "builder-reset" &&
          action.id !== "builder-save-template",
      );
    };
  }, [creator]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const resetAction = creator.toolbar.actions.find((action) => action.id === "builder-reset");
    const saveAction = creator.toolbar.actions.find((action) => action.id === "svd-save");
    const saveTemplateAction = creator.toolbar.actions.find((action) => action.id === "builder-save-template");

    if (resetAction) {
      resetAction.enabled = !isSurveyMutationBusy && !isTemplateBusy;
      resetAction.innerCss = "builder-toolbar-action-button";
    }

    if (saveAction) {
      saveAction.css = "builder-toolbar-action-item";
      saveAction.innerCss = `builder-toolbar-action-button ${isSaving ? "builder-toolbar-action-button-pending" : ""}`.trim();
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
    navigate(routes.dashboardMy, { replace: true });
  };

  const handleSavePostSaveSettings = async () => {
    if (!postSaveSettings) {
      return;
    }

    const normalizedDeadline = postSaveSettings.deadlineValue.trim();
    const normalizedLimit = postSaveSettings.responseLimitValue.trim();
    let deadlineAt: string | null = null;
    let maxResponses: number | null = null;

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
    const stopPendingLogger = createPendingStateLogger(queryClient, `builder post-save settings ${postSaveSettings.formId}`);

    try {
      await Promise.all([
        deadlineMutation.mutateAsync({ id: postSaveSettings.formId, deadlineAt }),
        responseLimitMutation.mutateAsync({ id: postSaveSettings.formId, maxResponses }),
      ]);

      scheduleBuilderQueryRefresh(postSaveSettings.formId);
      showToast("Настройки формы сохранены", "success");
      closePostSaveSettings();
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

    creator.saveSurveyFunc = async (saveNo, callback) => {
      setIsSaving(true);
      const stopPendingLogger = createPendingStateLogger(queryClient, formId ? `builder save ${formId}` : "builder create");

      try {
        const schema = serializeDefaultSurveyLogo(cloneSchema(creator.JSON as SurveySchema));
        if (!validateSurveySchema(schema)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        const title = getSchemaTitle(schema, editableForm?.title ?? "Новая форма");

        let savedFormId = formId;
        const isTemplate = Boolean(editableForm && isTemplateForm(editableForm));

        if (formId) {
          await saveSurveyMutation.mutateAsync({
            id: formId,
            schema,
            title,
          });
        } else {
          const createdForm = await createSurveyMutation.mutateAsync({
            schema,
            title,
          });
          savedFormId = createdForm.id;
        }

        scheduleBuilderQueryRefresh(savedFormId);

        showToast(
          formId ? (isTemplate ? "Шаблон обновлён" : "Форма обновлена") : "Форма сохранена",
          "success",
        );
        clearSurveyBuilderDraft(formId);
        if (savedFormId && !isTemplate) {
          setPostSaveSettings({
            formId: savedFormId,
            title,
            deadlineValue: formatDateTimeLocalValue(editableForm?.deadline_at ?? null),
            responseLimitValue: editableForm?.max_responses ? String(editableForm.max_responses) : "",
          });
        } else {
          navigate(routes.dashboardMy, { replace: true });
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

    return () => {
      creator.saveSurveyFunc = undefined;
    };
  }, [creator, createSurveyMutation, editableForm, formId, navigate, queryClient, saveSurveyMutation, showToast]);

  return (
    <div className="builder-host">
      <div className="builder-status-stack">
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

      {isResetConfirmOpen && (
        <div className="modal-backdrop">
          <div className="modal-card card builder-reset-modal">
            <h3 className="builder-reset-title">Сбросить конструктор?</h3>
            <p className="builder-template-subtitle">
              Все несохранённые вопросы и поля будут очищены. Это действие нельзя отменить.
            </p>
            <div className="deadline-modal-actions">
              <button type="button" onClick={() => setIsResetConfirmOpen(false)} disabled={isSurveyMutationBusy || isTemplateBusy}>
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

      {postSaveSettings && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal" role="dialog" aria-modal="true" aria-label="Настройки формы">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Настройки формы</h3>
            <p className="deadline-modal-subtitle">{postSaveSettings.title}</p>
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
            <p className="deadline-modal-hint">
              Оставьте поле пустым, если дедлайн или ограничение по ответам не нужны.
            </p>
            <div className="deadline-modal-actions">
              <button type="button" onClick={closePostSaveSettings} disabled={isPostSaveSettingsSaving}>
                Пропустить
              </button>
              <button
                type="button"
                onClick={() => void handleSavePostSaveSettings()}
                disabled={isPostSaveSettingsSaving}
              >
                {isPostSaveSettingsSaving && <InlineSpinner />}
                Сохранить настройки
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

