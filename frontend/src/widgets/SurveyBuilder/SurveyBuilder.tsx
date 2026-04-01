import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import { editorLocalization } from "survey-creator-core";
import { surveyLocalization } from "survey-core";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { useCreateSurveyMutation } from "../../features/create-survey/useCreateSurvey";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getFormById, saveSurveySchema } from "../../entities/survey/api/surveysApi";
import type { SurveySchema } from "../../entities/survey/types";
import { getErrorMessage } from "../../shared/lib/error";

const BASIC_TYPES = [
  "text",
  "text_phone",
  "text_email",
  "comment",
  "radiogroup",
  "checkbox",
  "dropdown",
];

const ADVANCED_TYPES = [
  "boolean",
  "rating",
  "ranking",
  "tagbox",
  "text_integer",
  "text_number",
  "text_date",
  "text_time",
  "text_datetime-local",
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
];

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

function configureCreatorToolbox(nextCreator: SurveyCreator) {
  const toolbox = nextCreator.toolbox;

  toolbox.showCategoryTitles = true;

  toolbox.addItem({
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
      },
      placeholder: "+7(999)-999-99-99",
      validators: [
        {
          type: "regex",
          regex: "^\\+7\\(\\d{3}\\)-\\d{3}-\\d{2}-\\d{2}$",
          text: "Введите телефон в формате +7(999)-999-99-99",
        },
      ],
      titleLocation: "top",
    },
  });

  toolbox.addItem({
    name: "text_email",
    iconName: "icon-text",
    title: "email",
    category: "basic",
    json: {
      type: "text",
      inputType: "email",
      titleLocation: "top",
    },
  });

  toolbox.addItem({
    name: "text_integer",
    iconName: "icon-text",
    title: "Целое число",
    category: "advanced",
    json: { type: "text", inputType: "number", step: 1 },
  });

  toolbox.addItem({
    name: "text_number",
    iconName: "icon-text",
    title: "Число",
    category: "advanced",
    json: { type: "text", inputType: "number", step: "any" },
  });

  toolbox.addItem({
    name: "text_date",
    iconName: "icon-text",
    title: "Дата",
    category: "advanced",
    json: { type: "text", inputType: "date" },
  });

  toolbox.addItem({
    name: "text_time",
    iconName: "icon-text",
    title: "Время",
    category: "advanced",
    json: { type: "text", inputType: "time" },
  });

  toolbox.addItem({
    name: "text_datetime-local",
    iconName: "icon-text",
    title: "Дата и время",
    category: "advanced",
    json: { type: "text", inputType: "datetime-local" },
  });

  toolbox.defineCategories([
    {
      category: "basic",
      title: "Базовые",
      items: BASIC_TYPES,
    },
    {
      category: "advanced",
      title: "Расширенные",
      items: ADVANCED_TYPES,
    },
  ]);

  const commentItem = toolbox.getItemByName("comment");
  if (commentItem) {
    commentItem.title = "Абзац";
    commentItem.category = "basic";
  }

  const textItem = toolbox.getItemByName("text");
  if (textItem) {
    textItem.title = "Текст";
    textItem.category = "basic";
  }
}

function createCreatorInstance() {
  configureCreatorLocalization();

  const nextCreator = new SurveyCreator({
    showLogicTab: true,
    showPreviewTab: true,
    showJSONEditorTab: false,
    showSaveButton: true,
    isAutoSave: false,
  });

  nextCreator.locale = "ru";
  nextCreator.JSON = {
    ...createEmptySurveySchema(),
    locale: "ru",
  };
  nextCreator.allowCollapseSidebar = true;

  configureCreatorToolbox(nextCreator);

  nextCreator.onQuestionAdded.add((_sender, options) => {
    if (options.question) {
      options.question.isRequired = true;
    }
  });

  nextCreator.sidebar.expandSidebar();
  nextCreator.sidebar.collapseSidebar();

  return nextCreator;
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
          "error"
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
