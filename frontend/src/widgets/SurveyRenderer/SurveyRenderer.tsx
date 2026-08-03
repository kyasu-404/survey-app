import type { SurveySchema } from "../../entities/survey/types";
import type { ITheme } from "survey-core";
import { SurveyFormRenderer, type SurveyRenderMode } from "../../features/render-form/SurveyFormRenderer";

type SurveyRendererProps = {
  schema: SurveySchema;
  theme?: ITheme;
  formId: string;
  respondentId?: string;
  initialData?: Record<string, unknown>;
  initialPageNo?: number;
  renderMode?: SurveyRenderMode;
  isPreview?: boolean;
  allowAnonymousUploads?: boolean;
  allowResponseEditing?: boolean;
};

export function SurveyRenderer({
  schema,
  theme,
  formId,
  respondentId,
  initialData,
  initialPageNo,
  renderMode,
  isPreview = false,
  allowAnonymousUploads = false,
  allowResponseEditing = false,
}: SurveyRendererProps) {
  return (
    <SurveyFormRenderer
      schema={schema}
      theme={theme}
      formId={formId}
      respondentId={respondentId}
      initialData={initialData}
      initialPageNo={initialPageNo}
      renderMode={renderMode}
      isPreview={isPreview}
      allowAnonymousUploads={allowAnonymousUploads}
      allowResponseEditing={allowResponseEditing}
    />
  );
}
