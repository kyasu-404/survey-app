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
  title?: string;
  description?: string;
  pages: SurveyPageSchema[];
};

export type SurveyForm = {
  id: string;
  title: string;
  form_type: string;
  form_reason: string;
  author_id: string;
  schema: SurveySchema;
  created_at: string;
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
