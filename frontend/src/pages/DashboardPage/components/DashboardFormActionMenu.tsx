import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import { getSurveyDisplayTitle, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import copyIcon from "../../../img/copy.svg";
import copyLinkIcon from "../../../img/copy_link.svg";
import deleteIcon from "../../../img/delete.svg";
import editIcon from "../../../img/edit.svg";
import qrIcon from "../../../img/qr.svg";
import renameIcon from "../../../img/rename.svg";
import type { OpenMenuState } from "../types";

type DashboardFormActionMenuProps = {
  actionMenuOpen: boolean;
  currentUserId?: string;
  form: SurveyFormSummary;
  isFirstVisibleForm: boolean;
  isPending: boolean;
  onCopyLink: (formId: string) => void;
  onDeleteRequest: (form: SurveyFormSummary) => void;
  onDuplicate: (form: SurveyFormSummary) => void;
  onEditForm: (formId: string) => void;
  onOpenQrCode: (form: SurveyFormSummary) => void;
  onRename: (form: SurveyFormSummary) => void;
  qrGeneratingFormId: string | null;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
};

function stopCardEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
  event.stopPropagation();
}

export function DashboardFormActionMenu({
  actionMenuOpen,
  currentUserId,
  form,
  isFirstVisibleForm,
  isPending,
  onCopyLink,
  onDeleteRequest,
  onDuplicate,
  onEditForm,
  onOpenQrCode,
  onRename,
  qrGeneratingFormId,
  setOpenedMenu,
}: DashboardFormActionMenuProps) {
  const title = getSurveyDisplayTitle(form);
  const isOwnForm = form.author_id === currentUserId;
  const isTemplate = isTemplateForm(form);

  return (
    <div
      className={`form-menu dashboard-floating-root dashboard-actions-menu-shell ${
        isFirstVisibleForm ? "dashboard-actions-menu-shell-open-down" : ""
      }`.trim()}
    >
      <button
        type="button"
        className="form-menu-trigger"
        aria-label={`${isTemplate ? "Действия шаблона" : "Действия формы"} ${title}`}
        aria-expanded={actionMenuOpen}
        onClick={(event) => {
          stopCardEvent(event);
          setOpenedMenu((current) =>
            current?.kind === "actions" && current.formId === form.id ? null : { kind: "actions", formId: form.id },
          );
        }}
        disabled={isPending}
      >
        ...
      </button>

      {actionMenuOpen && (
        <div
          className="form-menu-dropdown"
          role="menu"
          aria-label={`${isTemplate ? "Меню действий шаблона" : "Меню действий формы"} ${title}`}
          onClick={stopCardEvent}
        >
          {!isTemplate && (
            <>
              <button
                type="button"
                role="menuitem"
                className="form-menu-item"
                onClick={(event) => {
                  stopCardEvent(event);
                  setOpenedMenu(null);
                  void onCopyLink(form.id);
                }}
                disabled={isPending}
              >
                <img src={copyLinkIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                <span className="form-menu-item-label">Копировать ссылку</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="form-menu-item"
                onClick={(event) => {
                  stopCardEvent(event);
                  setOpenedMenu(null);
                  void onOpenQrCode(form);
                }}
                disabled={isPending || qrGeneratingFormId === form.id}
              >
                <img src={qrIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                <span className="form-menu-item-label">Генерировать QR</span>
              </button>
            </>
          )}

          {(isTemplate || isOwnForm) && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item"
              onClick={(event) => {
                stopCardEvent(event);
                setOpenedMenu(null);
                void onRename(form);
              }}
              disabled={isPending}
            >
              <img src={renameIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
              <span className="form-menu-item-label">Переименовать</span>
            </button>
          )}

          {isOwnForm && !isTemplate && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item"
              onClick={(event) => {
                stopCardEvent(event);
                setOpenedMenu(null);
                onEditForm(form.id);
              }}
              disabled={isPending}
            >
              <img src={editIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
              <span className="form-menu-item-label">Редактировать</span>
            </button>
          )}

          {!isTemplate && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item"
              onClick={(event) => {
                stopCardEvent(event);
                setOpenedMenu(null);
                void onDuplicate(form);
              }}
              disabled={isPending}
            >
              <img src={copyIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
              <span className="form-menu-item-label">Дублировать</span>
            </button>
          )}

          {(isTemplate || isOwnForm) && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item form-menu-item-danger"
              onClick={(event) => {
                stopCardEvent(event);
                setOpenedMenu(null);
                onDeleteRequest(form);
              }}
              disabled={isPending}
            >
              <img src={deleteIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
              <span className="form-menu-item-label">Удалить</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
