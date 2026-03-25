import { useMemo, useState } from "react";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import { editorLocalization } from "survey-creator-core";
import "survey-core/survey.i18n";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { createSurveyForCurrentUser } from "../../features/create-survey/useCreateSurvey";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import { useToast } from "../../app/providers/ToastProvider";

export function SurveyBuilder() {
  const [isSaving, setIsSaving] = useState(false);
  const { showToast } = useToast();

  const creator = useMemo(() => {
    editorLocalization.currentLocale = "ru";
    const nextCreator = new SurveyCreator({ showLogicTab: true, isAutoSave: false });
    nextCreator.locale = "ru";

    if (!nextCreator.JSON?.pages?.length) {
      nextCreator.JSON = createEmptySurveySchema();
    }

    nextCreator.saveSurveyFunc = async (saveNo, callback) => {
      setIsSaving(true);
      try {
        if (!validateSurveySchema(nextCreator.JSON)) {
          throw new Error("Некорректная JSON-схема формы");
        }

        await createSurveyForCurrentUser(nextCreator.JSON, nextCreator.JSON.title ?? "Новая форма");
        showToast("Форма сохранена", "success");
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

    return nextCreator;
  }, [showToast]);

  return (
    <div className="builder-host">
      {isSaving && <p style={{ marginBottom: 10, color: "#334155" }}>Сохранение формы...</p>}
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
