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
  elements: SurveyQuestion[];
};

export type SurveySchema = {
  locale?: string;
  title?: string;
  description?: string;
  pages: SurveyPageSchema[];
};

export type SurveyForm = {
  id: string;
  title: string;
  form_type: string;
  form_reason: string;
  is_public: boolean;
  deadline_at: string | null;
  author_id: string;
  schema: SurveySchema;
  created_at: string;
  author_email?: string | null;
  author_name?: string | null;
  responses_count?: number;
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
