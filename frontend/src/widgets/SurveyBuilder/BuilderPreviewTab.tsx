import { useSyncExternalStore } from "react";
import { ReactElementFactory } from "survey-react-ui";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";
import { SurveyRuntimeSurface } from "../SurveyRenderer/SurveyRuntimeSurface";
import { getBuilderPreviewSnapshot, subscribeBuilderPreview } from "./builderPreviewBridge";

export const BUILDER_PREVIEW_TAB_ID = "runtime-preview";
export const BUILDER_PREVIEW_COMPONENT_NAME = "svc-tab-runtime-preview";

export function BuilderPreviewTab() {
  const { formId, previewSchema, previewTheme } = useSyncExternalStore(
    subscribeBuilderPreview,
    getBuilderPreviewSnapshot,
    getBuilderPreviewSnapshot,
  );

  return (
    <div className="builder-preview-tab-shell survey-page survey-page-shell" data-testid="builder-preview-tab">
      <SurveyRuntimeSurface className="card builder-preview-tab-surface">
        <SurveyFormRenderer
          schema={previewSchema}
          theme={previewTheme}
          formId={formId ?? "__builder_preview__"}
          renderMode="preview-interactive"
        />
      </SurveyRuntimeSurface>
    </div>
  );
}

export function registerBuilderPreviewTabComponent() {
  if (ReactElementFactory.Instance.isElementRegistered(BUILDER_PREVIEW_COMPONENT_NAME)) {
    return;
  }

  ReactElementFactory.Instance.registerElement(BUILDER_PREVIEW_COMPONENT_NAME, () => <BuilderPreviewTab />);
}
