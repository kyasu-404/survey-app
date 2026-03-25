export const routes = {
  home: "/",
  dashboardMy: "/dashboard/my",
  dashboardAll: "/dashboard/all",
  surveyById: "/form/:id",
  survey: (id: string) => `/form/${id}`,
  legacySurveyById: "/survey/:id",
  builder: "/builder",
  login: "/login",
} as const;
