import type { SurveyCreator } from "survey-creator-react";
import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import type { SurveySchema } from "../../entities/survey/types";

type SplitPreviewState = {
  splitCreator: SurveyCreator | null;
  previewSchema: SurveySchema;
  formId?: string;
};

const listeners = new Set<() => void>();

let state: SplitPreviewState = {
  splitCreator: null,
  previewSchema: createEmptySurveySchema(),
};

export function getSplitPreviewSnapshot() {
  return state;
}

export function subscribeSplitPreview(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function updateSplitPreviewBridge(nextState: Partial<SplitPreviewState>) {
  state = {
    ...state,
    ...nextState,
  };

  listeners.forEach((listener) => {
    listener();
  });
}
