import { lazy } from "react";

export const LazySurveyRenderer = lazy(async () => {
  const { SurveyFormRenderer } = await import("../../features/render-form/SurveyFormRenderer");
  return { default: SurveyFormRenderer };
});
