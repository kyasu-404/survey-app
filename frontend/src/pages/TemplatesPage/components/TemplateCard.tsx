import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import shareIcon from "../../../img/share.svg";
import useIcon from "../../../img/use.svg";
import { getSurveyDisplayTitle } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { formatCreatedAt, getAuthorLabel } from "../templatesPageUtils";
import type { TemplatesSection } from "../types";
import { TemplateCardMenu } from "./TemplateCardMenu";

type TemplateCardProps = {
  actionMenuOpen: boolean;
  currentUserId?: string;
  isPending: boolean;
  isPinned: boolean;
  onCloseMenu: () => void;
  onDeleteRequest: (template: SurveyFormSummary) => void;
  onEditTemplate: (path: string) => void;
  onOpen: (template: SurveyFormSummary) => void;
  onRename: (template: SurveyFormSummary) => void;
  onToggleMenu: () => void;
  onTogglePin: (templateId: string) => void;
  onToggleSharing: (template: SurveyFormSummary) => void;
  onUseTemplate: (template: SurveyFormSummary) => void;
  section: TemplatesSection;
  template: SurveyFormSummary;
};

function stopCardEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
  event.stopPropagation();
}

export function TemplateCard({
  actionMenuOpen,
  currentUserId,
  isPending,
  isPinned,
  onCloseMenu,
  onDeleteRequest,
  onEditTemplate,
  onOpen,
  onRename,
  onToggleMenu,
  onTogglePin,
  onToggleSharing,
  onUseTemplate,
  section,
  template,
}: TemplateCardProps) {
  const title = getSurveyDisplayTitle(template);
  const isOwnTemplate = template.author_id === currentUserId;
  const createdAtLabel = formatCreatedAt(template.created_at);
  const shareLabel = template.is_public ? "Не показывать другим" : "Поделиться";

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpen(template);
  };

  return (
    <div
      className={`dashboard-form-card dashboard-form-card-static templates-card ${
        actionMenuOpen ? "dashboard-form-card-menu-open" : ""
      }`.trim()}
      role="button"
      tabIndex={0}
      aria-label={`Открыть превью шаблона ${title}`}
      onClick={() => onOpen(template)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="templates-card-header">
        <div className="dashboard-form-heading-row templates-card-title-row">
          <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
          <strong className="dashboard-form-title templates-card-title">{title}</strong>
        </div>
        <button
          type="button"
          className={`templates-pin-button ${isPinned ? "templates-pin-button-active" : ""}`.trim()}
          aria-label={`${isPinned ? "Открепить" : "Закрепить"} шаблон ${title}`}
          aria-pressed={isPinned}
          onClick={(event) => {
            stopCardEvent(event);
            onTogglePin(template.id);
          }}
        >
          <span aria-hidden="true">★</span>
        </button>
      </div>

      <div className="templates-card-meta-line">
        <span className="dashboard-meta-item">Создан {createdAtLabel}</span>
        {section === "public" && (
          <>
            <span className="dashboard-meta-separator" aria-hidden="true">
              •
            </span>
            <span className="templates-card-author">{getAuthorLabel(template)}</span>
          </>
        )}
      </div>

      <div className="templates-card-actions">
        <div className="templates-card-button-row">
          <button
            type="button"
            className="templates-use-button"
            aria-label={`Использовать шаблон ${title}`}
            onClick={(event) => {
              stopCardEvent(event);
              void onUseTemplate(template);
            }}
            disabled={isPending}
          >
            <span>Использовать</span>
            <img src={useIcon} alt="" aria-hidden="true" className="templates-action-icon" />
          </button>

          {isOwnTemplate && (
            <button
              type="button"
              className={`templates-share-button ${template.is_public ? "templates-share-button-muted" : ""}`.trim()}
              aria-label={`${shareLabel} шаблоном ${title}`}
              onClick={(event) => {
                stopCardEvent(event);
                void onToggleSharing(template);
              }}
              disabled={isPending}
            >
              <span>{shareLabel}</span>
              <img src={shareIcon} alt="" aria-hidden="true" className="templates-action-icon" />
            </button>
          )}
        </div>

        {isOwnTemplate && (
          <TemplateCardMenu
            actionMenuOpen={actionMenuOpen}
            isPending={isPending}
            onCloseMenu={onCloseMenu}
            onDeleteRequest={onDeleteRequest}
            onEditTemplate={onEditTemplate}
            onRename={onRename}
            onToggleMenu={onToggleMenu}
            template={template}
            title={title}
          />
        )}
      </div>
    </div>
  );
}
