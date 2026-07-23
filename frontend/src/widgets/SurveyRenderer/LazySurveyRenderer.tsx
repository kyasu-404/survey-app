import { lazy } from "react";

export const LazySurveyRenderer = lazy(async () => {
  const { SurveyRenderer } = await import("./SurveyRenderer");

  return { default: SurveyRenderer };
});
