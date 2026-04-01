import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { editorLocalization } from "survey-creator-core";
import { SurveyCreator, SurveyCreatorComponent } from "survey-creator-react";
import { surveyLocalization } from "survey-core";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getFormById, saveSurveySchema } from "../../entities/survey/api/surveysApi";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import type { SurveySchema } from "../../entities/survey/types";
import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { getErrorMessage } from "../../shared/lib/error";

type SurveyBuilderProps = {
  formId?: string;
};

function configureCreatorLocalization() {
  surveyLocalization.defaultLocale = "ru";
  editorLocalization.currentLocale = "ru";

  const ruEditorStrings = editorLocalization.getLocaleStrings("ru");
  if (ruEditorStrings?.tabs) {
    ruEditorStrings.tabs.designer = "Конструктор";
    ruEditorStrings.tabs.preview = "Превью";
    ruEditorStrings.tabs.logic = "Логика формы";
  }
}

function configureCreatorToolbox(creator: SurveyCreator) {
  const toolbox = creator.toolbox;

  toolbox.showCategoryTitles = true;
  toolbox.clearItems();

  const basicItems = [
    {
      name: "text",
      iconName: "icon-text",
      title: "Текст",
      category: "basic",
      json: { type: "text", titleLocation: "top" },
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
      iconName: "icon-text",
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
      iconName: "icon-text",
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
      iconName: "icon-text",
      title: "Дата",
      category: "basic",
      json: { type: "text", inputType: "date", titleLocation: "top" },
    },
    {
      name: "text_time",
      iconName: "icon-text",
      title: "Время",
      category: "basic",
      json: { type: "text", inputType: "time", titleLocation: "top" },
    },
    {
      name: "text_datetime-local",
      iconName: "icon-text",
      title: "Дата и время",
      category: "basic",
      json: { type: "text", inputType: "datetime-local", titleLocation: "top" },
    },
    {
      name: "text_phone",
      iconName: "icon-text",
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
      iconName: "icon-text",
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

function createCreatorInstance() {
  configureCreatorLocalization();

  const creator = new SurveyCreator({
    showLogicTab: true,
    showPreviewTab: true,
    showJSONEditorTab: false,
    showSaveButton: true,
    isAutoSave: false,
  });

  creator.locale = "ru";
  creator.JSON = {
    ...createEmptySurveySchema(),
    locale: "ru",
  };
  creator.allowCollapseSidebar = true;

  configureCreatorToolbox(creator);

  creator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      options.question.isRequired = true;
    }
  });

  return creator;
}

export function SurveyBuilder({ formId }: SurveyBuilderProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [creator, setCreator] = useState<SurveyCreator | null>(null);
  const { showToast } = useToast();
  const createSurveyMutation = useCreateSurveyMutation();
  const saveSurveyMutation = useMutation({
    mutationFn: ({ id, schema, title }: { id: string; schema: SurveySchema; title: string }) =>
      saveSurveySchema(id, schema, title),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);

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

    const frame = window.requestAnimationFrame(() => {
      if (creator.sidebar && typeof creator.sidebar.collapseSidebar === "function") {
        creator.sidebar.collapseSidebar();
      } else {
        creator.setShowSidebar(false);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [creator]);

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
    if (!editableFormError) {
      return;
    }

    showToast(getErrorMessage(editableFormError, "Не удалось загрузить форму"), "error");
  }, [editableFormError, showToast]);

  useEffect(() => {
    if (!creator || !editableForm) {
      return;
    }

    creator.locale = editableForm.schema.locale ?? "ru";
    creator.JSON = {
      ...editableForm.schema,
      title: editableForm.title,
      locale: editableForm.schema.locale ?? "ru",
    };

    window.requestAnimationFrame(() => {
      if (creator.sidebar && typeof creator.sidebar.collapseSidebar === "function") {
        creator.sidebar.collapseSidebar();
      }
    });
  }, [creator, editableForm]);

  useEffect(() => {
    if (!creator) {
      return;
    }

    creator.saveSurveyFunc = async (saveNo, callback) => {
      setIsSaving(true);

      try {
        const schema = creator.JSON;
        if (!validateSurveySchema(schema)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        const title = schema.title ?? editableForm?.title ?? "Новая форма";

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

        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        if (formId) {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["form", formId] }),
            queryClient.invalidateQueries({ queryKey: ["survey-form", formId] }),
          ]);
        }

        showToast(formId ? "Форма обновлена" : "Форма сохранена", "success");
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
  }, [creator, createSurveyMutation, editableForm?.title, formId, navigate, queryClient, saveSurveyMutation, showToast]);

  return (
    <div className="builder-host">
      {isEditableFormLoading && <p style={{ marginBottom: 10, color: "#334155" }}>Загрузка формы...</p>}
      {isSaving && <p style={{ marginBottom: 10, color: "#334155" }}>Сохранение формы...</p>}
      {creator && <SurveyCreatorComponent creator={creator} />}
    </div>
  );
}
