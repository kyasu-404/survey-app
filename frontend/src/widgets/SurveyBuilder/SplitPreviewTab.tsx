import { useSyncExternalStore } from "react";
import { ReactElementFactory } from "survey-react-ui";
import { SurveyCreatorComponent } from "survey-creator-react";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";
import { getSplitPreviewSnapshot, subscribeSplitPreview } from "./splitPreviewBridge";

export const SPLIT_PREVIEW_COMPONENT_NAME = "svc-tab-split-preview";

export function SplitPreviewTab() {
  const { formId, previewSchema, splitCreator } = useSyncExternalStore(
    subscribeSplitPreview,
    getSplitPreviewSnapshot,
    getSplitPreviewSnapshot,
  );

  return (
    <div className="builder-split-preview-tab">
      <section className="builder-split-preview-tab__designer" aria-label="Редактор формы">
        {splitCreator ? (
          <SurveyCreatorComponent creator={splitCreator} />
        ) : (
          <div className="builder-split-preview-tab__empty">Редактор загружается</div>
        )}
      </section>

      <aside className="builder-split-preview-tab__preview" aria-label="Предпросмотр формы">
        <div className="builder-split-preview-tab__preview-header">
          <h3>Превью</h3>
          <p>Изменения появляются здесь сразу.</p>
        </div>
        <div className="builder-split-preview-tab__preview-body">
          <SurveyFormRenderer schema={previewSchema} formId={formId ?? "__builder_preview__"} isPreview />
        </div>
      </aside>
    </div>
  );
}

export function registerSplitPreviewTabComponent() {
  if (ReactElementFactory.Instance.isElementRegistered(SPLIT_PREVIEW_COMPONENT_NAME)) {
    return;
  }

  ReactElementFactory.Instance.registerElement(SPLIT_PREVIEW_COMPONENT_NAME, () => <SplitPreviewTab />);
}
