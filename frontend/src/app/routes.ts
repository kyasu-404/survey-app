export const routes = {
  home: "/",
  surveyById: "/form/:id",
  survey: (id: string) => `/form/${id}`,
  legacySurveyById: "/survey/:id",
  builder: "/builder",
  login: "/login",
} as const;
