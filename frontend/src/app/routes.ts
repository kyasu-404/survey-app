export const routes = {
  home: "/",
  surveyById: "/survey/:id",
  survey: (id: string) => `/survey/${id}`,
  builder: "/builder",
  login: "/login",
} as const;
