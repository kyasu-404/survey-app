import type { Dispatch, SetStateAction } from "react";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { TemplatesSection } from "../types";
import { TemplateCard } from "./TemplateCard";

type TemplatesGridProps = {
  currentUserId?: string;
  isTemplateActionPending: (templateId: string) => boolean;
  onDeleteRequest: (template: SurveyFormSummary) => void;
  onEditTemplate: (path: string) => void;
  onOpenTemplate: (template: SurveyFormSummary) => void;
  onRename: (template: SurveyFormSummary) => void;
  onTogglePin: (templateId: string) => void;
  onToggleSharing: (template: SurveyFormSummary) => void;
  onUseTemplate: (template: SurveyFormSummary) => void;
  openedMenuTemplateId: string | null;
  pinnedTemplateIds: string[];
  section: TemplatesSection;
  setOpenedMenuTemplateId: Dispatch<SetStateAction<string | null>>;
  templates: SurveyFormSummary[];
};

export function TemplatesGrid({
  currentUserId,
  isTemplateActionPending,
  onDeleteRequest,
  onEditTemplate,
  onOpenTemplate,
  onRename,
  onTogglePin,
  onToggleSharing,
  onUseTemplate,
  openedMenuTemplateId,
  pinnedTemplateIds,
  section,
  setOpenedMenuTemplateId,
  templates,
}: TemplatesGridProps) {
  return (
    <div
      className={`templates-gallery-grid templates-gallery-grid-two-columns ${
        openedMenuTemplateId ? "templates-gallery-grid-menu-open" : ""
      }`.trim()}
    >
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          actionMenuOpen={openedMenuTemplateId === template.id}
          currentUserId={currentUserId}
          isPending={isTemplateActionPending(template.id)}
          isPinned={pinnedTemplateIds.includes(template.id)}
          onCloseMenu={() => setOpenedMenuTemplateId(null)}
          onDeleteRequest={onDeleteRequest}
          onEditTemplate={onEditTemplate}
          onOpen={onOpenTemplate}
          onRename={onRename}
          onToggleMenu={() => setOpenedMenuTemplateId((current) => (current === template.id ? null : template.id))}
          onTogglePin={onTogglePin}
          onToggleSharing={onToggleSharing}
          onUseTemplate={onUseTemplate}
          section={section}
          template={template}
        />
      ))}
    </div>
  );
}
