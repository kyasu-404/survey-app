import { useMemo } from "react";
import { SurveyCreatorComponent, SurveyCreator } from "survey-creator-react";
import "survey-core/defaultV2.min.css";
import "survey-creator-core/survey-creator-core.min.css";

import { createSurveyForCurrentUser } from "../../features/create-survey/useCreateSurvey";
import { validateSurveySchema } from "../../entities/survey/model/validateSchema";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";

export function SurveyBuilder() {
  const creator = useMemo(() => {
    const nextCreator = new SurveyCreator({ showLogicTab: true, isAutoSave: false });

    if (!nextCreator.JSON?.pages?.length) {
      nextCreator.JSON = createEmptySurveySchema();
    }

    nextCreator.saveSurveyFunc = async (saveNo, callback) => {
      try {
        if (!validateSurveySchema(nextCreator.JSON)) {
          throw new Error("Некорректная JSON schema формы");
        }

        await createSurveyForCurrentUser(nextCreator.JSON, nextCreator.JSON.title ?? "Новая форма");
        callback(saveNo, true);
      } catch (error) {
        console.error(error);
        callback(saveNo, false);
      }
    };

    return nextCreator;
  }, []);

  return <SurveyCreatorComponent creator={creator} />;
}
