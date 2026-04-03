import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { editorLocalization } from "survey-creator-core";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import { settings, SvgRegistry, surveyLocalization } from "survey-core";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";
import phoneIcon from "../../img/constructor/Phone.svg?raw";
import emailIcon from "../../img/constructor/Email.svg?raw";
import floatIcon from "../../img/constructor/float.svg?raw";
import integerIcon from "../../img/constructor/integer.svg?raw";
import dateIcon from "../../img/constructor/Date.svg?raw";
import timeIcon from "../../img/constructor/Time.svg?raw";
import dateTimeIcon from "../../img/constructor/Date-Time.svg?raw";

import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getFormById, getForms, saveSurveySchema } from "../../entities/survey/api/surveysApi";
import { TEMPLATE_FORM_TYPE, createEmptySurveySchema, isTemplateForm } from "../../entities/survey/model/surveyModel";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";
import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { getErrorMessage } from "../../shared/lib/error";

type SurveyBuilderProps = {
  formId?: string;
};

function configureCreatorLocalization() {
  surveyLocalization.defaultLocale = "ru";
  editorLocalization.currentLocale = "ru";
  const ruEditorStrings = editorLocalization.getLocaleStrings("ru");
  if (ruEditorStrings) {
    ruEditorStrings.pagePlaceHolder = "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
    ruEditorStrings.pagePlaceHolderMobile = "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043f\u0443\u0441\u0442\u0430. \u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0441 \u043f\u0430\u043d\u0435\u043b\u0438 \u0438\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442\u043e\u0432 \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043d\u0430 \u043d\u0435\u0433\u043e";
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

  const basicItems = [
    {
      name: "text_plain",
      iconName: "icon-text",
      title: "Текст",
      category: "basic",
      json: { type: "text", inputType: "text", titleLocation: "top" },
    },
    {
      name: "comment",
      iconName: "icon-comment",
      title: "Абзац",
      category: "basic",
      json: { type: "comment", titleLocation: "top" },
    },
    {
      name: "radiogroup",
      iconName: "icon-radiogroup",
      title: "Единичный выбор",
      category: "basic",
      json: { type: "radiogroup" },
    },
    {
      name: "checkbox",
      iconName: "icon-checkbox",
      title: "Множественный выбор",
      category: "basic",
      json: { type: "checkbox" },
    },
    {
      name: "dropdown",
      iconName: "icon-dropdown",
      title: "Выпадающий список",
      category: "basic",
      json: { type: "dropdown" },
    },
    {
      name: "text_number",
      iconName: "icon-toolbox-float-custom",
      title: "Число",
      category: "basic",
      json: {
        type: "text",
        inputType: "number",
        step: "any",
        titleLocation: "top",
      },
    },
    {
      name: "text_integer",
      iconName: "icon-toolbox-integer-custom",
      title: "Целое число",
      category: "basic",
      json: {
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
      name: "text_date",
      iconName: "icon-toolbox-date-custom",
      title: "Дата",
      category: "basic",
      json: { type: "text", inputType: "date", titleLocation: "top" },
    },
    {
      name: "text_time",
      iconName: "icon-toolbox-time-custom",
      title: "Время",
      category: "basic",
      json: { type: "text", inputType: "time", titleLocation: "top" },
    },
    {
      name: "text_datetime-local",
      iconName: "icon-toolbox-datetime-custom",
      title: "Дата и время",
      category: "basic",
      json: { type: "text", inputType: "datetime-local", titleLocation: "top" },
    },
    {
      name: "text_phone",
      iconName: "icon-toolbox-phone-custom",
      title: "Телефон",
      category: "basic",
      json: {
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
      name: "text_email",
      iconName: "icon-toolbox-email-custom",
      title: "email",
      category: "basic",
      json: {
        type: "text",
        inputType: "email",
        titleLocation: "top",
      },
    },
  ];

  const advancedItems = [
    { name: "boolean", iconName: "icon-boolean", title: "Да/Нет", category: "advanced", json: { type: "boolean" } },
    { name: "rating", iconName: "icon-rating", title: "Рейтинг", category: "advanced", json: { type: "rating" } },
    { name: "ranking", iconName: "icon-ranking", title: "Ранжирование", category: "advanced", json: { type: "ranking" } },
    { name: "tagbox", iconName: "icon-tagbox", title: "Теги", category: "advanced", json: { type: "tagbox" } },
    { name: "matrix", iconName: "icon-matrix", title: "Матрица", category: "advanced", json: { type: "matrix" } },
    { name: "matrixdropdown", iconName: "icon-matrixdropdown", title: "Матрица с выбором", category: "advanced", json: { type: "matrixdropdown" } },
    { name: "matrixdynamic", iconName: "icon-matrixdynamic", title: "Динамическая матрица", category: "advanced", json: { type: "matrixdynamic" } },
    { name: "multipletext", iconName: "icon-multipletext", title: "Несколько полей", category: "advanced", json: { type: "multipletext" } },
    { name: "image", iconName: "icon-image", title: "Изображение", category: "advanced", json: { type: "image" } },
    { name: "imagepicker", iconName: "icon-imagepicker", title: "Выбор изображения", category: "advanced", json: { type: "imagepicker" } },
    { name: "file", iconName: "icon-file", title: "Файл", category: "advanced", json: { type: "file" } },
    { name: "signaturepad", iconName: "icon-signaturepad", title: "Подпись", category: "advanced", json: { type: "signaturepad" } },
    { name: "panel", iconName: "icon-panel", title: "Панель", category: "advanced", json: { type: "panel" } },
    { name: "paneldynamic", iconName: "icon-paneldynamic", title: "Динамическая панель", category: "advanced", json: { type: "paneldynamic" } },
    { name: "expression", iconName: "icon-expression", title: "Выражение", category: "advanced", json: { type: "expression" } },
    { name: "html", iconName: "icon-html", title: "HTML", category: "advanced", json: { type: "html" } },
  ];

  [...basicItems, ...advancedItems].forEach((item, index) => {
    toolbox.addItem(item, index);
  });

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

function createCreatorInstance() {
  configureCreatorLocalization();
  registerCustomIcons();
  settings.allowShowEmptyDescriptionInDesignMode = true;

  const creator = new SurveyCreator({
    showLogicTab: true,
    showPreviewTab: true,
    showJSONEditorTab: false,
    showSaveButton: true,
    isAutoSave: false,
    showAddQuestionButton: false,
  });

  creator.locale = "ru";
  creator.JSON = {
    ...createEmptySurveySchema(),
    locale: "ru",
    questionDescriptionLocation: "underTitle",
  };
  creator.allowCollapseSidebar = true;

  configureCreatorToolbox(creator);

  creator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      options.question.isRequired = true;
      options.question.descriptionLocation = "underTitle";
    }
  });

  creator.onElementAllowOperations.add((_sender, options) => {
    options.allowChangeType = true;
    options.allowChangeInputType = false;
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

function collapseSidebarOnNextPaint(creator: SurveyCreator) {
  creator.setShowSidebar(false);

  const frameId = window.requestAnimationFrame(() => {
    creator.setShowSidebar(false);
    creator.sidebar?.collapseSidebar?.();
  });

  const timeoutId = window.setTimeout(() => {
    creator.setShowSidebar(false);
    creator.sidebar?.collapseSidebar?.();
  }, 120);

  return () => {
    window.cancelAnimationFrame(frameId);
    window.clearTimeout(timeoutId);
  };
}

export function SurveyBuilder({ formId }: SurveyBuilderProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);
  const [isTemplateActionLoading, setIsTemplateActionLoading] = useState<"save" | "create" | null>(null);
  const { user } = useAuth();
  const { showToast } = useToast();
  const createSurveyMutation = useCreateSurveyMutation();
  const saveSurveyMutation = useMutation({
    mutationFn: ({ id, schema, title }: { id: string; schema: SurveySchema; title: string }) =>
      saveSurveySchema(id, schema, title),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);
  const isBusy = isSaving || saveSurveyMutation.isPending || createSurveyMutation.isPending || isTemplateActionLoading !== null;
  const saveTemplateHandlerRef = useRef<() => void>(() => undefined);
  const createFromTemplateHandlerRef = useRef<() => void>(() => undefined);

  const {
    data: editableForm,
    isLoading: isEditableFormLoading,
    error: editableFormError,
  } = useQuery({
    queryKey: ["form", formId],
    queryFn: () => getFormById(formId ?? ""),
    enabled: isEditMode,
  });

  const {
    data: templateForms = [],
    isLoading: isTemplateFormsLoading,
    error: templateFormsError,
  } = useQuery({
    queryKey: ["builder-templates", user?.id],
    queryFn: async () => {
      const forms = await getForms({ authorId: user?.id });
      return forms.filter((form) => isTemplateForm(form));
    },
    enabled: Boolean(user?.id),
  });

  useEffect(() => {
    const nextCreator = createCreatorInstance();
    setCreator(nextCreator);

    return () => {
      nextCreator.dispose();
    };
  }, []);

  useEffect(() => {
    if (!creator) {
      return;
    }

    return collapseSidebarOnNextPaint(creator);
  }, [creator]);

  useEffect(() => {
    if (!editableFormError) {
      return;
    }

    showToast(getErrorMessage(editableFormError, "Не удалось загрузить форму"), "error");
  }, [editableFormError, showToast]);

  useEffect(() => {
    if (!templateFormsError) {
      return;
    }

    showToast(getErrorMessage(templateFormsError, "Не удалось загрузить шаблоны"), "error");
  }, [showToast, templateFormsError]);

  useEffect(() => {
    if (!creator || !editableForm) {
      return;
    }

    creator.locale = editableForm.schema.locale ?? "ru";
    creator.JSON = {
      ...editableForm.schema,
      title: editableForm.title,
      locale: editableForm.schema.locale ?? "ru",
      questionDescriptionLocation: editableForm.schema.questionDescriptionLocation ?? "underTitle",
    };

    return collapseSidebarOnNextPaint(creator);
  }, [creator, editableForm]);

  const invalidateBuilderQueries = async (affectedFormId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["forms"] }),
      queryClient.invalidateQueries({ queryKey: ["builder-templates"] }),
      queryClient.refetchQueries({ queryKey: ["forms"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["builder-templates"], type: "active" }),
    ]);

    if (affectedFormId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["form", affectedFormId] }),
        queryClient.invalidateQueries({ queryKey: ["survey-form", affectedFormId] }),
        queryClient.refetchQueries({ queryKey: ["form", affectedFormId], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["survey-form", affectedFormId], type: "active" }),
      ]);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!creator) {
      return;
    }

    setIsTemplateActionLoading("save");

    try {
      const schema = cloneSchema(creator.JSON as SurveySchema);
      if (!validateSurveySchema(schema)) {
        throw new Error("Некорректная JSON-схема формы");
      }

      const title = getSchemaTitle(schema, editableForm?.title ?? "Новый шаблон");

      await createSurveyMutation.mutateAsync({
        schema,
        title,
        formType: TEMPLATE_FORM_TYPE,
      });

      await invalidateBuilderQueries();
      showToast("Шаблон сохранён", "success");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось сохранить шаблон"), "error");
    } finally {
      setIsTemplateActionLoading(null);
    }
  };

  const handleCreateFromTemplate = async (templateForm: SurveyForm) => {
    setIsTemplateActionLoading("create");

    try {
      const schema = cloneSchema({
        ...templateForm.schema,
        title: templateForm.title,
      });

      const createdForm = await createSurveyMutation.mutateAsync({
        schema,
        title: templateForm.title,
      });

      await invalidateBuilderQueries(createdForm.id);
      setIsTemplatePickerOpen(false);
      showToast("Форма создана из шаблона", "success");
      navigate(routes.builderEdit(createdForm.id));
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось создать форму из шаблона"), "error");
    } finally {
      setIsTemplateActionLoading(null);
    }
  };

  saveTemplateHandlerRef.current = () => {
    void handleSaveAsTemplate();
  };

  createFromTemplateHandlerRef.current = () => {
    setIsTemplatePickerOpen(true);
  };

  useEffect(() => {
    if (!creator) {
      return;
    }

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

    creator.toolbar.addAction(
      {
        id: "builder-create-template",
        title: "Создать из шаблона",
        showTitle: true,
        disableShrink: true,
        css: "builder-toolbar-action-item",
        innerCss: "builder-toolbar-action-button builder-toolbar-action-button-secondary",
        action: () => {
          createFromTemplateHandlerRef.current();
        },
      },
      true,
    );

    const saveTemplateAction = creator.toolbar.getActionById("builder-save-template");
    const createFromTemplateAction = creator.toolbar.getActionById("builder-create-template");

    if (saveTemplateAction) {
      saveTemplateAction.visibleIndex = 10;
    }

    if (createFromTemplateAction) {
      createFromTemplateAction.visibleIndex = 11;
    }

    return () => {
      creator.toolbar.actions = creator.toolbar.actions.filter(
        (action) => action.id !== "builder-save-template" && action.id !== "builder-create-template",
      );
    };
  }, [creator]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    const saveTemplateAction = creator.toolbar.actions.find((action) => action.id === "builder-save-template");
    const createFromTemplateAction = creator.toolbar.actions.find((action) => action.id === "builder-create-template");

    if (saveTemplateAction) {
      saveTemplateAction.enabled = !isBusy;
    }

    if (createFromTemplateAction) {
      createFromTemplateAction.enabled = !isBusy;
    }
  }, [creator, isBusy]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    creator.saveSurveyFunc = async (saveNo, callback) => {
      setIsSaving(true);

      try {
        const schema = creator.JSON as SurveySchema;
        if (!validateSurveySchema(schema)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        const title = getSchemaTitle(schema, editableForm?.title ?? "Новая форма");

        if (formId) {
          await saveSurveyMutation.mutateAsync({
            id: formId,
            schema,
            title,
          });
        } else {
          await createSurveyMutation.mutateAsync({
            schema,
            title,
          });
        }

        await invalidateBuilderQueries(formId);

        showToast(
          formId ? (editableForm && isTemplateForm(editableForm) ? "Шаблон обновлён" : "Форма обновлена") : "Форма сохранена",
          "success",
        );
        navigate(routes.dashboardMy, { replace: true });
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
        {isEditableFormLoading && <p className="builder-status-text">Загрузка формы...</p>}
        {isSaving && <p className="builder-status-text">Сохранение формы...</p>}
        {isTemplateActionLoading === "save" && <p className="builder-status-text">Сохранение шаблона...</p>}
        {isTemplateActionLoading === "create" && <p className="builder-status-text">Создание формы из шаблона...</p>}
      </div>

      <div className="builder-creator-shell">
        {creator && <SurveyCreatorComponent creator={creator} />}
      </div>

      {isTemplatePickerOpen && (
        <div className="modal-backdrop">
          <div className="modal-card card builder-template-modal">
            <h3 className="builder-template-title">Выберите шаблон</h3>
            <p className="builder-template-subtitle">Для создания новой формы доступны только сохранённые шаблоны.</p>

            {isTemplateFormsLoading && <p className="builder-status-text">Загрузка шаблонов...</p>}

            {!isTemplateFormsLoading && templateForms.length === 0 && (
              <div className="builder-template-empty-state">
                <h4>Шаблонов пока нет</h4>
                <p>Сначала сохраните текущую форму как шаблон, а затем создавайте из неё новые формы.</p>
              </div>
            )}

            {!isTemplateFormsLoading && templateForms.length > 0 && (
              <div className="builder-template-list">
                {templateForms.map((templateForm) => (
                  <button
                    key={templateForm.id}
                    type="button"
                    className="builder-template-card"
                    onClick={() => void handleCreateFromTemplate(templateForm)}
                    disabled={isBusy}
                  >
                    <span className="builder-template-card-title">{templateForm.title}</span>
                    <span className="builder-template-card-meta">
                      Создан {new Date(templateForm.created_at).toLocaleString("ru-RU")}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="deadline-modal-actions">
              <button type="button" onClick={() => setIsTemplatePickerOpen(false)} disabled={isBusy}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

