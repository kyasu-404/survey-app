import { createEmptySurveySchema } from "../../entities/survey/model/surveyModel";
import type { SurveySchema } from "../../entities/survey/types";

type BuilderPreviewState = {
  previewSchema: SurveySchema;
  formId?: string;
};

const listeners = new Set<() => void>();

let state: BuilderPreviewState = {
  previewSchema: createEmptySurveySchema(),
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
