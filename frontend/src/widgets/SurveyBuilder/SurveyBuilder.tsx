import { useMemo, useState } from "react";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import { editorLocalization } from "survey-creator-core";
import "survey-core/survey.i18n";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { createSurveyForCurrentUser } from "../../features/create-survey/useCreateSurvey";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";

export function SurveyBuilder() {
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const creator = useMemo(() => {
    editorLocalization.currentLocale = "ru";
    const nextCreator = new SurveyCreator({ showLogicTab: true, isAutoSave: false });
    nextCreator.locale = "ru";

    if (!nextCreator.JSON?.pages?.length) {
      nextCreator.JSON = createEmptySurveySchema();
    }

    nextCreator.saveSurveyFunc = async (saveNo, callback) => {
      try {
        if (!validateSurveySchema(nextCreator.JSON)) {
          throw new Error("Некорректная JSON schema формы");
        }

        await createSurveyForCurrentUser(nextCreator.JSON, nextCreator.JSON.title ?? "Новая форма");
        setMessageType("success");
        setMessage("Форма сохранена!");
        callback(saveNo, true);
      } catch (error) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : "Не удалось сохранить форму";
        setMessageType("error");
        setMessage(
          errorMessage === "Пользователь не авторизован"
            ? "Вы не авторизованы. Войдите в систему и повторите попытку."
            : errorMessage
        );
        callback(saveNo, false);
      }
    };

    return nextCreator;
  }, []);

  return (
    <div className="builder-host">
      {message && (
        <div
          style={{
            marginBottom: 10,
            padding: 10,
            borderRadius: 8,
            background: messageType === "success" ? "#dcfce7" : "#fee2e2",
            color: messageType === "success" ? "#166534" : "#991b1b"
          }}
        >
          {message}
        </div>
      )}
      <SurveyCreatorComponent creator={creator} />
    </div>
  );
}
