import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { routes } from "../../../app/routes";
import deleteIcon from "../../../img/delete.svg";
import editIcon from "../../../img/edit.svg";
import renameIcon from "../../../img/rename.svg";
import type { SurveyFormSummary } from "../../../entities/survey/types";

type TemplateCardMenuProps = {
  actionMenuOpen: boolean;
  isPending: boolean;
  onCloseMenu: () => void;
  onDeleteRequest: (template: SurveyFormSummary) => void;
  onEditTemplate: (path: string) => void;
  onRename: (template: SurveyFormSummary) => void;
  onToggleMenu: () => void;
  template: SurveyFormSummary;
  title: string;
};

function stopCardEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
  event.stopPropagation();
}

export function TemplateCardMenu({
  actionMenuOpen,
  isPending,
  onCloseMenu,
  onDeleteRequest,
  onEditTemplate,
  onRename,
  onToggleMenu,
  template,
  title,
}: TemplateCardMenuProps) {
  return (
    <div className="form-menu templates-floating-root templates-actions-menu-shell">
      <button
        type="button"
        className="form-menu-trigger"
        aria-label={`Действия шаблона ${title}`}
        aria-expanded={actionMenuOpen}
        onClick={(event) => {
          stopCardEvent(event);
          onToggleMenu();
        }}
        disabled={isPending}
      >
        ...
      </button>

      {actionMenuOpen && (
        <div className="form-menu-dropdown templates-menu-dropdown" role="menu" aria-label={`Меню действий шаблона ${title}`} onClick={stopCardEvent}>
          <button
            type="button"
            role="menuitem"
            className="form-menu-item"
            onClick={(event) => {
              stopCardEvent(event);
              onCloseMenu();
              void onRename(template);
            }}
            disabled={isPending}
          >
            <img src={renameIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
            <span className="form-menu-item-label">Переименовать</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="form-menu-item"
            onClick={(event) => {
              stopCardEvent(event);
              onCloseMenu();
              onEditTemplate(routes.builderEdit(template.id));
            }}
            disabled={isPending}
          >
            <img src={editIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
            <span className="form-menu-item-label">Редактировать</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="form-menu-item form-menu-item-danger"
            onClick={(event) => {
              stopCardEvent(event);
              onCloseMenu();
              onDeleteRequest(template);
            }}
            disabled={isPending}
          >
            <img src={deleteIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
            <span className="form-menu-item-label">Удалить</span>
          </button>
        </div>
      )}
    </div>
  );
}
