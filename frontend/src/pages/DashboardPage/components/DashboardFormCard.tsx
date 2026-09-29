import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  SetStateAction,
} from "react";
import { getFormReasonLabel, getFormTypeLabel } from "../../../entities/survey/model/formOptions";
import { getSurveyDisplayTitle, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { DashboardLayout, DashboardViewMode, OpenMenuState } from "../types";
import { formatDashboardCreatedAt, formatDashboardDeadlineLabel, getAuthorLabel, getResponsesCounterLabel, isResponseLimitReached } from "../dashboardPageUtils";
import { DashboardFormActionMenu } from "./DashboardFormActionMenu";
import { DashboardFormMetaLine } from "./DashboardFormMetaLine";
import { DashboardFormStatusControl } from "./DashboardFormStatusControl";
import shareBlackIcon from "../../../img/Share_black.svg";
import shareWhiteIcon from "../../../img/Share_white.svg";
import { useTheme } from "../../../shared/theme/ThemeProvider";
import { DashboardDeadlineTooltip } from "./DashboardDeadlineTooltip";

type DashboardFormCardProps = {
  layout?: DashboardLayout;
  currentUserId?: string;
  form: SurveyFormSummary;
  formIndex: number;
  isPending: boolean;
  onDeleteRequest: (form: SurveyFormSummary) => void;
  onDuplicate: (form: SurveyFormSummary) => void;
  onEditForm: (formId: string) => void;
  onOpenDeadlineEditor: (form: SurveyFormSummary) => void;
  onOpenForm: (form: SurveyFormSummary) => void;
  onShare: (form: SurveyFormSummary) => void;
  onOpenResponseLimitEditor: (form: SurveyFormSummary) => void;
  onOpenResponses: (formId: string) => void;
  onRename: (form: SurveyFormSummary) => void;
  onToggleStatus: (form: SurveyFormSummary) => void;
  openedMenu: OpenMenuState;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
  viewMode: DashboardViewMode;
};

export function DashboardFormCard({
  layout = "cards",
  currentUserId,
  form,
  formIndex,
  isPending,
  onDeleteRequest,
  onDuplicate,
  onEditForm,
  onOpenDeadlineEditor,
  onOpenForm,
  onShare,
  onOpenResponseLimitEditor,
  onOpenResponses,
  onRename,
  onToggleStatus,
  openedMenu,
  setOpenedMenu,
  viewMode,
}: DashboardFormCardProps) {
  const { themeId } = useTheme();
  const title = getSurveyDisplayTitle(form);
  const isOwnForm = form.author_id === currentUserId;
  const isTemplate = isTemplateForm(form);
  const actionMenuOpen = openedMenu?.kind === "actions" && openedMenu.formId === form.id;
  const statusMenuOpen = openedMenu?.kind === "status" && openedMenu.formId === form.id;
  const formTypeLabel = getFormTypeLabel(form.form_type);
  const formReasonLabel = getFormReasonLabel(form.form_reason);

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenForm(form);
  };

  const statusControl = (
    <DashboardFormStatusControl
      portal={layout === "table"}
      form={form}
      isOwnForm={isOwnForm}
      isPending={isPending}
      onOpenDeadlineEditor={onOpenDeadlineEditor}
      onOpenResponseLimitEditor={onOpenResponseLimitEditor}
      onToggleStatus={onToggleStatus}
      setOpenedMenu={setOpenedMenu}
      statusMenuOpen={statusMenuOpen}
    />
  );
  const actionMenu = (
    <div className="dashboard-form-actions">
      {!isTemplate && (
        <button
          type="button"
          className="form-menu-trigger dashboard-share-button"
          aria-label={`Поделиться формой ${title}`}
          title="Поделиться"
          aria-haspopup="dialog"
          disabled={isPending}
          onClick={(event) => { event.stopPropagation(); setOpenedMenu(null); onShare(form); }}
        >
          <img src={themeId === "graphite" ? shareWhiteIcon : shareBlackIcon} alt="" aria-hidden="true" />
        </button>
      )}
    <DashboardFormActionMenu
      portal={layout === "table"}
      actionMenuOpen={actionMenuOpen}
      currentUserId={currentUserId}
      form={form}
      isFirstVisibleForm={formIndex === 0}
      isPending={isPending}
      onDeleteRequest={onDeleteRequest}
      onDuplicate={onDuplicate}
      onEditForm={onEditForm}
      onRename={onRename}
      setOpenedMenu={setOpenedMenu}
    />
    </div>
  );

  if (layout === "table") {
    const responseCount = form.responses_count ?? 0;
    const responsesLabel = getResponsesCounterLabel(responseCount, form.max_responses);
    const deadlineLabel = form.deadline_at ? `Открыта до ${formatDashboardDeadlineLabel(form.deadline_at)}` : null;
    return (
      <tr className="dashboard-form-table-row" onClick={() => onOpenForm(form)}>
        <td>{statusControl}</td>
        <td className="dashboard-form-table-title">
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpenForm(form); }}>{title}</button>
        </td>
        <td>{formTypeLabel} · {formReasonLabel}</td>
        {viewMode !== "mine" && <td>{getAuthorLabel(form)}</td>}
        <td className="dashboard-form-table-date"><time dateTime={form.created_at}>{formatDashboardCreatedAt(form.created_at)}</time></td>
        <td className="dashboard-form-table-count">
          <div className="dashboard-table-response-summary">
            <button
              type="button"
              className={`dashboard-responses-link ${isResponseLimitReached(responseCount, form.max_responses) ? "dashboard-responses-link-limit-reached" : ""}`.trim()}
              title={responsesLabel}
              aria-label={`Ответы формы ${title}: ${responsesLabel}`}
              onClick={(event) => { event.stopPropagation(); onOpenResponses(form.id); }}
            >
              {responsesLabel}
            </button>
            {deadlineLabel && <DashboardDeadlineTooltip label={deadlineLabel} />}
          </div>
        </td>
        <td>{actionMenu}</td>
      </tr>
    );
  }

  return (
    <div
      className={`dashboard-form-card ${!isTemplate ? "dashboard-form-card-interactive" : "dashboard-form-card-static"} ${
        actionMenuOpen || statusMenuOpen ? "dashboard-form-card-menu-open" : ""
      }`.trim()}
      role={isTemplate ? undefined : "button"}
      tabIndex={isTemplate ? undefined : 0}
      aria-label={isTemplate ? undefined : `Открыть превью формы ${title}`}
      onClick={() => onOpenForm(form)}
      onKeyDown={handleCardKeyDown}
    >
      <div className={`dashboard-form-header ${statusMenuOpen ? "dashboard-form-header-status-menu-open" : ""}`.trim()}>
        <div className="dashboard-form-heading">
          <div className="dashboard-form-heading-content">
            <div className="dashboard-form-heading-row">
              {statusControl}

              <strong className="dashboard-form-title">{title}</strong>
            </div>
            {!isTemplate && (
              <p className="dashboard-form-classification">
                <span>{formTypeLabel}</span>
                <span aria-hidden="true">•</span>
                <span>{formReasonLabel}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-form-footer">
        <DashboardFormMetaLine form={form} onOpenResponses={onOpenResponses} viewMode={viewMode} />

        {actionMenu}
      </div>
    </div>
  );
}
