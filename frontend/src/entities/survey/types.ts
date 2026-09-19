import type { ITheme } from "survey-core";
import type { OrganizationType } from "../organization/types";

export type SurveyQuestion = {
  integrationId?: string;
  type: string;
  name: string;
  title?: string;
  isRequired?: boolean;
  showNumber?: boolean;
  hideNumber?: boolean;
  showQuestionNumbers?: string | boolean;
  choices?: Array<string | { value: string; text: string; imageLink?: string }>;
  elements?: SurveyQuestion[];
  templateElements?: SurveyQuestion[];
  pages?: SurveyPageSchema[];
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
  showQuestionNumbers?: boolean | string;
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
  allow_response_editing?: boolean;
  organization_types?: OrganizationType[];
  author_id: string;
  schema: SurveySchema;
  theme: ITheme;
  created_at: string;
  author_email?: string | null;
  author_name?: string | null;
  responses_count?: number;
};

export type FormsSort = {
  field: "status" | "title" | "classification" | "author_name" | "created_at" | "responses_count";
  direction: "asc" | "desc";
};

export type SurveyFormSummary = Omit<SurveyForm, "schema" | "theme" | "allow_response_editing"> & {
  list_cursor?: FormsCursor;
};

export type FormsCursor = {
  // Keep PostgreSQL's original timestamp string, including microseconds.
  createdAt: string;
  id: string;
  sort?: FormsSort;
  sortValue?: string;
  referenceTime?: string;
};

export type PaginatedSurveyFormSummaries = {
  hasMore: boolean;
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
