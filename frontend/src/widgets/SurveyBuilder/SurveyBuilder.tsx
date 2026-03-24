import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { createSurveyForCurrentUser } from "../../features/create-survey/useCreateSurvey";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";

export function SurveyBuilder() {
  const creator = new SurveyCreator({ showLogicTab: true, isAutoSave: false });

  creator.saveSurveyFunc = async (_saveNo, callback) => {
    try {
      if (!validateSurveySchema(creator.JSON)) {
        throw new Error("Некорректная JSON schema формы");
      }

      await createSurveyForCurrentUser(creator.JSON, creator.JSON.title ?? "Новая форма");
      callback(_saveNo, true);
    } catch (error) {
      console.error(error);
      callback(_saveNo, false);
    }
  };

  return <SurveyCreatorComponent creator={creator} />;
}
