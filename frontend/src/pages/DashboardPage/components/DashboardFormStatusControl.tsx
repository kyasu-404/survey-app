import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import { getSurveyDisplayTitle, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { OpenMenuState } from "../types";

type DashboardFormStatusControlProps = {
  form: SurveyFormSummary;
  isOwnForm: boolean;
  isPending: boolean;
  onOpenDeadlineEditor: (form: SurveyFormSummary) => void;
  onOpenResponseLimitEditor: (form: SurveyFormSummary) => void;
  onToggleStatus: (form: SurveyFormSummary) => void;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
  statusMenuOpen: boolean;
};

function stopCardEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
  event.stopPropagation();
}

export function DashboardFormStatusControl({
  form,
  isOwnForm,
  isPending,
  onOpenDeadlineEditor,
  onOpenResponseLimitEditor,
  onToggleStatus,
  setOpenedMenu,
  statusMenuOpen,
}: DashboardFormStatusControlProps) {
  const title = getSurveyDisplayTitle(form);
  const isTemplate = isTemplateForm(form);
  const isFormActive = form.is_public;
  const statusLabel = isTemplate ? "Шаблон" : isFormActive ? "Активна" : "Закрыта";

  if (isTemplate) {
    return <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>;
  }

  if (!isOwnForm) {
    return (
      <span className={`dashboard-status-pill ${isFormActive ? "dashboard-status-pill-active" : "dashboard-status-pill-closed"}`.trim()}>
        {statusLabel}
      </span>
    );
  }

  return (
    <div className="form-menu dashboard-floating-root dashboard-status-menu-shell">
      <button
        type="button"
        className={`dashboard-status-pill dashboard-status-trigger dashboard-status-trigger-glossy ${
          isFormActive ? "dashboard-status-pill-active" : "dashboard-status-pill-closed"
        }`.trim()}
        aria-label={`Статус формы ${title}: ${statusLabel}`}
        aria-expanded={statusMenuOpen}
        onClick={(event) => {
          stopCardEvent(event);
          setOpenedMenu((current) =>
            current?.kind === "status" && current.formId === form.id ? null : { kind: "status", formId: form.id },
          );
        }}
      >
        {statusLabel}
      </button>

      {statusMenuOpen && (
        <div
          className="form-menu-dropdown form-menu-dropdown-inline dashboard-status-dropdown"
          role="menu"
          aria-label={`Статус формы ${title}`}
          onClick={stopCardEvent}
        >
          <button
            type="button"
            role="menuitem"
            className={`form-menu-item ${isFormActive ? "form-menu-item-danger" : "dashboard-status-menu-item-open"}`.trim()}
            onClick={(event) => {
              stopCardEvent(event);
              setOpenedMenu(null);
              void onToggleStatus(form);
            }}
            disabled={isPending}
          >
            {isFormActive ? "Закрыть" : "Открыть"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="form-menu-item"
            onClick={(event) => {
              stopCardEvent(event);
              setOpenedMenu(null);
              onOpenDeadlineEditor(form);
            }}
            disabled={isPending}
          >
            Установить дедлайн
          </button>
          <button
            type="button"
            role="menuitem"
            className="form-menu-item"
            onClick={(event) => {
              stopCardEvent(event);
              setOpenedMenu(null);
              onOpenResponseLimitEditor(form);
            }}
            disabled={isPending}
          >
            Ограничить ответы
          </button>
        </div>
      )}
    </div>
  );
}
