import type { SelectableOrganization } from "../../entities/organization/types";
import type { SurveySchema } from "../../entities/survey/types";
import type { ITheme } from "survey-core";
import { SurveyFormRenderer, type SurveyRenderMode } from "../../features/render-form/SurveyFormRenderer";
import type { ExistingResponseResult } from "../../entities/response/types";

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
  existingResponse?: ExistingResponseResult | null;
  responseBrowserId?: string;
  personalToken?: string;
  personalOrganization?: SelectableOrganization;
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
  existingResponse = null,
  responseBrowserId,
  personalToken,
  personalOrganization,
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
      existingResponse={existingResponse}
      responseBrowserId={responseBrowserId}
      personalToken={personalToken}
      personalOrganization={personalOrganization}
    />
  );
}
