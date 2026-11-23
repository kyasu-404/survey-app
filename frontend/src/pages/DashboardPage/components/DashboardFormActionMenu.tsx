import { useActionMenuKeyboard } from "../../../shared/ui/useActionMenuKeyboard";
import { MoreHorizontalIcon } from "../../../shared/ui/MoreHorizontalIcon";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { routes } from "../../../app/routes";
import { countActiveFormRules } from "../../../entities/automation/api";
import { automationKey } from "../../../entities/automation/model";
import "./dashboardFormActionMenu.css";
import { DashboardMenuPortal } from "./DashboardMenuPortal";
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import { canManageSurveyForm } from "../../../entities/survey/model/formAccess";
import { getSurveyDisplayTitle, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { Icon } from "../../../shared/ui/Icon";
import type { OpenMenuState } from "../types";

type DashboardFormActionMenuProps = {
  portal?: boolean;
  actionMenuOpen: boolean;
  canAdministerAllForms?: boolean;
  currentUserId?: string;
  form: SurveyFormSummary;
  isFirstVisibleForm: boolean;
  isPending: boolean;
  onDeleteRequest: (form: SurveyFormSummary) => void;
  onDuplicate: (form: SurveyFormSummary) => void;
  onEditForm: (formId: string) => void;
  onRename: (form: SurveyFormSummary) => void;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
};

function stopCardEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
  event.stopPropagation();
}

function FormAutomationsItem({ formId, userId, disabled, onClose }: { formId: string; userId: string; disabled: boolean; onClose: () => void }) {
  const count = useQuery({
    queryKey: [...automationKey(userId), "active-count", formId],
    queryFn: ({ signal }) => countActiveFormRules(userId, formId, signal),
    refetchOnMount: true,
  });
  return <Link role="menuitem" className="form-menu-item" to={routes.formAutomations(formId)}
    aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
    onClick={event => { stopCardEvent(event); if (disabled) event.preventDefault(); else onClose(); }}>
    <Icon name="bolt" className="form-menu-item-icon" size={18} />
    <span className="form-menu-item-label">Автоматизации</span>
    {count.data !== undefined && <span role="img" className="form-rule-count" aria-label={`Активных правил: ${count.data}`}
      title={`Активных правил: ${count.data}`}>{count.data}</span>}
  </Link>;
}

export function DashboardFormActionMenu({
  portal = false,
  actionMenuOpen,
  canAdministerAllForms = false,
  currentUserId,
  form,
  isFirstVisibleForm,
  isPending,
  onDeleteRequest,
  onDuplicate,
  onEditForm,
  onRename,
  setOpenedMenu,
}: DashboardFormActionMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const keyboard = useActionMenuKeyboard(actionMenuOpen, () => setOpenedMenu({ kind: "actions", formId: form.id }), () => setOpenedMenu(null));
  const title = getSurveyDisplayTitle(form);
  const isOwnForm = form.author_id === currentUserId;
  const canManageForm = canManageSurveyForm(form, currentUserId ?? "", canAdministerAllForms);
  const isTemplate = isTemplateForm(form);

  if (!canManageForm && !isTemplate) {
    return (
      <button
        type="button"
        className="form-menu-trigger dashboard-duplicate-button"
        aria-label={`Дублировать форму ${title}`}
        title="Дублировать форму"
        disabled={isPending}
        onClick={(event) => {
          stopCardEvent(event);
          setOpenedMenu(null);
          void onDuplicate(form);
        }}
      >
        <Icon name="content_copy" className="form-menu-item-icon" size={18} />
      </button>
    );
  }

  return (
    <div
      ref={anchorRef}
      className={`form-menu dashboard-floating-root dashboard-actions-menu-shell ${
        isFirstVisibleForm ? "dashboard-actions-menu-shell-open-down" : ""
      }`.trim()}
    >
      <button
        type="button"
        className="form-menu-trigger"
        aria-label={`${isTemplate ? "Действия шаблона" : "Действия формы"} ${title}`}
        ref={keyboard.trigger}
        aria-haspopup="menu"
        onKeyDown={keyboard.triggerKeyDown}
        aria-expanded={actionMenuOpen}
        onClick={(event) => {
          stopCardEvent(event);
          setOpenedMenu((current) =>
            current?.kind === "actions" && current.formId === form.id ? null : { kind: "actions", formId: form.id },
          );
        }}
        disabled={isPending}
      >
        <MoreHorizontalIcon />
      </button>

      <DashboardMenuPortal anchor={anchorRef} enabled={portal} align="right">
        {actionMenuOpen && (
        <div
          className="form-menu-dropdown"
          role="menu"
          ref={keyboard.menu}
          onKeyDown={keyboard.menuKeyDown}
          aria-label={`${isTemplate ? "Меню действий шаблона" : "Меню действий формы"} ${title}`}
          onClick={stopCardEvent}
        >
          {(isTemplate || canManageForm) && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item"
              onClick={(event) => {
                stopCardEvent(event);
                keyboard.trigger.current?.focus({ preventScroll: true });
                setOpenedMenu(null);
                void onRename(form);
              }}
              disabled={isPending}
            >
            <Icon name="drive_file_rename_outline" className="form-menu-item-icon" size={18} />
              <span className="form-menu-item-label">Переименовать</span>
            </button>
          )}

          {canManageForm && !isTemplate && (
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
            <Icon name="edit" className="form-menu-item-icon" size={18} />
              <span className="form-menu-item-label">Редактировать</span>
            </button>
          )}

          {isOwnForm && currentUserId && !isTemplate && <FormAutomationsItem formId={form.id} userId={currentUserId} disabled={isPending} onClose={() => setOpenedMenu(null)} />}

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
            <Icon name="content_copy" className="form-menu-item-icon" size={18} />
              <span className="form-menu-item-label">Дублировать</span>
            </button>
          )}

          {(isTemplate || canManageForm) && (
            <button
              type="button"
              role="menuitem"
              className="form-menu-item form-menu-item-danger"
              onClick={(event) => {
                stopCardEvent(event);
                keyboard.trigger.current?.focus({ preventScroll: true });
                setOpenedMenu(null);
                onDeleteRequest(form);
              }}
              disabled={isPending}
            >
              <Icon name="delete" className="form-menu-item-icon" size={18} />
              <span className="form-menu-item-label">Удалить</span>
            </button>
          )}
        </div>
        )}
      </DashboardMenuPortal>
    </div>
  );
}
