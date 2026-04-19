export type SurveyQuestion = {
  type: string;
  name: string;
  title?: string;
  isRequired?: boolean;
  choices?: Array<string | { value: string; text: string }>;
};

export type SurveyPageSchema = {
  name?: string;
  title?: string;
  description?: string;
  elements: SurveyQuestion[];
};

export type SurveySchema = {
  locale?: string;
  title?: string;
  description?: string;
  questionDescriptionLocation?: string;
  completedHtml?: string;
  showCompletePage?: boolean;
  logo?: string;
  logoWidth?: string | number;
  logoHeight?: string | number;
  logoFit?: "none" | "contain" | "cover" | "fill";
  logoPosition?: "none" | "left" | "right" | "top" | "bottom";
  pages: SurveyPageSchema[];
};

export type SurveyForm = {
  id: string;
  title: string;
  form_type: string;
  form_reason: string;
  is_public: boolean;
  deadline_at: string | null;
  max_responses?: number | null;
  author_id: string;
  schema: SurveySchema;
  created_at: string;
  author_email?: string | null;
  author_name?: string | null;
  responses_count?: number;
};

export type SurveyFormSummary = Omit<SurveyForm, "schema">;

export type PaginatedSurveyFormSummaries = {
  items: SurveyFormSummary[];
  totalCount: number;
};

export type DashboardFormsStats = {
  totalCount: number;
  activeCount: number;
  formsWithDeadlineCount: number;
};

export type Question =
  | {
      id: string
      type: 'text'
      label: string
      required?: boolean
    }
  | {
      id: string
      type: 'radio'
      label: string
      options: string[]
    }

export type Survey = {
  id: string
  title: string
  schema: Question[]
}
