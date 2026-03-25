import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import { editorLocalization } from "survey-creator-core";
import "survey-core/survey.i18n";
import "survey-creator-core/i18n/russian";
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

  const creatorRef = useRef<SurveyCreator | null>(null);
  if (!creatorRef.current) {
    editorLocalization.currentLocale = "ru";
    const nextCreator = new SurveyCreator({ showLogicTab: true, isAutoSave: false });
    nextCreator.theme = "default-light";
    nextCreator.locale = "ru";

    if (!nextCreator.JSON?.pages?.length) {
      nextCreator.JSON = createEmptySurveySchema();
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
  }, [createSurveyMutation, navigate, showToast]);

  const creator = creatorRef.current;

  return (
    <div className="builder-host">
      {isSaving && <p style={{ marginBottom: 10, color: "#334155" }}>Сохранение формы...</p>}
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
