import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  "comment",
  "text_integer",
  "text_number",
  "radiogroup",
  "checkbox",
  "text_phone",
  "text_email",
  "text_date",
  "text_time",
  "text_datetime-local",
];

const ADVANCED_TYPES = [
  "boolean",
  "rating",
  "ranking",
  "dropdown",
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
];

type SurveyBuilderProps = {
  formId?: string;
};

export function SurveyBuilder({ formId }: SurveyBuilderProps) {
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();
  const createSurveyMutation = useCreateSurveyMutation();
  const saveSurveyMutation = useMutation({
    mutationFn: ({ id, schema, title }: { id: string; schema: SurveySchema; title: string }) =>
      saveSurveySchema(id, schema, title),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(formId);

  const creatorRef = useRef<SurveyCreator | null>(null);
  if (!creatorRef.current) {
    surveyLocalization.defaultLocale = "ru";
    editorLocalization.currentLocale = "ru";
    const nextCreator = new SurveyCreator({ showLogicTab: true, showTestSurveyTab: true, isAutoSave: false });
    nextCreator.locale = "ru";
    nextCreator.JSON = {
      ...nextCreator.JSON,
      locale: "ru",
    };
    nextCreator.showJSONEditorTab = false;
    nextCreator.tabs = nextCreator.tabs.filter((tab) => tab.name !== "json");

    nextCreator.tabs.forEach((tab) => {
      if (tab.name === "designer") {
        tab.title = "Генератор";
      }

      if (tab.name === "test" || tab.name === "preview") {
        tab.title = "Превью";
      }
    });

    const toolbox = nextCreator.toolbox as unknown as {
      changeCategories: (
        categories: Array<{ name: string; title: string; category: string; items: string[] }>
      ) => void;
      addItem: (item: Record<string, unknown>) => void;
    };

    toolbox.addItem({
      name: "text_phone",
      iconName: "icon-text",
      title: "Телефон",
      category: "basic",
      json: {
        type: "text",
        inputType: "tel",
        maskType: "pattern",
        maskSettings: { pattern: "+7(999)999-99-99" },
        placeholder: "+7(999)999-99-99",
        titleLocation: "top",
      },
    });

    toolbox.addItem({
      name: "text_email",
      iconName: "icon-text",
      title: "Email",
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
      category: "basic",
      json: { type: "text", inputType: "number", step: 1 },
    });

    toolbox.addItem({
      name: "text_number",
      iconName: "icon-text",
      title: "Число",
      category: "basic",
      json: { type: "text", inputType: "number", step: "any" },
    });

    toolbox.addItem({
      name: "text_date",
      iconName: "icon-text",
      title: "Дата",
      category: "basic",
      json: { type: "text", inputType: "date" },
    });

    toolbox.addItem({
      name: "text_time",
      iconName: "icon-text",
      title: "Время",
      category: "basic",
      json: { type: "text", inputType: "time" },
    });

    toolbox.addItem({
      name: "text_datetime-local",
      iconName: "icon-text",
      title: "Дата и время",
      category: "basic",
      json: { type: "text", inputType: "datetime-local" },
    });

    toolbox.changeCategories([
      {
        name: "basic",
        title: "Базовые",
        category: "general",
        items: BASIC_TYPES,
      },
      {
        name: "advanced",
        title: "Расширенные",
        category: "general",
        items: ADVANCED_TYPES,
      },
    ]);

    nextCreator.onQuestionAdded.add((_sender, options) => {
      if (options.question) {
        options.question.isRequired = true;
      }
    });

    if (!nextCreator.JSON?.pages?.length) {
      nextCreator.JSON = {
        ...createEmptySurveySchema(),
        locale: "ru",
      };
    }

    creatorRef.current = nextCreator;
  }

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
    if (!creatorRef.current || !editableForm) {
      return;
    }

    creatorRef.current.JSON = editableForm.schema;
    creatorRef.current.JSON = {
      ...creatorRef.current.JSON,
      title: editableForm.title,
      locale: editableForm.schema.locale ?? "ru",
    };
  }, [editableForm]);

  useEffect(() => {
    if (!creatorRef.current) {
      return;
    }

    creatorRef.current.saveSurveyFunc = async (saveNo, callback) => {
      setIsSaving(true);
      try {
        if (!validateSurveySchema(creatorRef.current?.JSON)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        if (formId) {
          await saveSurveyMutation.mutateAsync({
            id: formId,
            schema: creatorRef.current.JSON,
            title: creatorRef.current.JSON.title ?? editableForm?.title ?? "Новая форма",
          });
        } else {
          await createSurveyMutation.mutateAsync({
            schema: creatorRef.current.JSON,
            title: creatorRef.current.JSON.title ?? "Новая форма",
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
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
  }, [createSurveyMutation, editableForm?.title, formId, navigate, queryClient, saveSurveyMutation, showToast]);

  const creator = creatorRef.current;

  return (
    <div className="builder-host">
      {isEditableFormLoading && <p style={{ marginBottom: 10, color: "#334155" }}>Загрузка формы...</p>}
      {isSaving && <p style={{ marginBottom: 10, color: "#334155" }}>Сохранение формы...</p>}
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
