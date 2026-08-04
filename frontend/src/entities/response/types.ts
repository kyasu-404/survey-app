export type SurveyResponse = {
  id: string;
  form_id: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
};

export type SubmitResponseResult = {
  status: "submitted" | "already_submitted";
  responseId: string;
  data: Record<string, unknown>;
  editable: boolean;
};

export type ExistingResponseResult = {
  responseId: string;
  data: Record<string, unknown>;
  editable: boolean;
};

export type UpdateResponseResult = {
  responseId: string;
  data: Record<string, unknown>;
};
