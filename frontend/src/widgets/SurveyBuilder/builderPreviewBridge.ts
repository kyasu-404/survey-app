import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import { DEFAULT_SURVEY_THEME } from "../../entities/survey/model/surveyTheme";
import type { SurveySchema } from "../../entities/survey/types";
import type { ITheme } from "survey-core";

type BuilderPreviewState = {
  previewSchema: SurveySchema;
  previewTheme: ITheme;
  formId?: string;
};

const listeners = new Set<() => void>();

let state: BuilderPreviewState = {
  previewSchema: createEmptySurveySchema(),
  previewTheme: DEFAULT_SURVEY_THEME,
};

export function getBuilderPreviewSnapshot() {
  return state;
}

export function subscribeBuilderPreview(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function updateBuilderPreviewBridge(nextState: Partial<BuilderPreviewState>) {
  state = {
    ...state,
    ...nextState,
  };

  listeners.forEach((listener) => {
    listener();
  });
}
