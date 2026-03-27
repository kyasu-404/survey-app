import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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

export function SurveyBuilder() {
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();
  const createSurveyMutation = useCreateSurveyMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

    const designerTab = nextCreator.tabs.find((tab) => tab.name === "designer");
    if (designerTab) {
      designerTab.title = "Генератор";
    }

    const testSurveyTab = nextCreator.tabs.find((tab) => tab.name === "test");
    if (testSurveyTab) {
      testSurveyTab.title = "Превью";
    }

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

        await createSurveyMutation.mutateAsync({
          schema: creatorRef.current.JSON,
          title: creatorRef.current.JSON.title ?? "Новая форма",
        });
        await queryClient.invalidateQueries({ queryKey: ["forms"] });
        showToast("Форма сохранена", "success");
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
  }, [createSurveyMutation, navigate, queryClient, showToast]);

  const creator = creatorRef.current;

  return (
    <div className="builder-host">
      {isSaving && <p style={{ marginBottom: 10, color: "#334155" }}>Сохранение формы...</p>}
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
