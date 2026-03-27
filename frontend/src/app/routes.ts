export const routes = {
  home: "/",
  dashboardMy: "/dashboard/my",
  dashboardAll: "/dashboard/all",
  surveyById: "/form/:id",
  survey: (id: string) => `/form/${id}`,
  legacySurveyById: "/survey/:id",
  builder: "/builder",
  builderById: "/builder/:id",
  builderEdit: (id: string) => `/builder/${id}`,
  users: "/users",
  login: "/login",
} as const;
