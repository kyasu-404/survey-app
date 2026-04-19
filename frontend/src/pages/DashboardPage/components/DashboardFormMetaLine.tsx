import type { MouseEvent as ReactMouseEvent } from "react";
import { isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import deadlineIcon from "../../../img/deadline.svg";
import {
  formatDashboardDeadlineLabel,
  getAuthorLabel,
  getResponsesCounterLabel,
  isResponseLimitReached,
} from "../dashboardPageUtils";
import type { DashboardViewMode } from "../types";

type DashboardFormMetaLineProps = {
  form: SurveyFormSummary;
  onOpenResponses: (formId: string) => void;
  viewMode: DashboardViewMode;
};

export function DashboardFormMetaLine({ form, onOpenResponses, viewMode }: DashboardFormMetaLineProps) {
  const isTemplate = isTemplateForm(form);
  const responsesCount = form.responses_count ?? 0;
  const createdAtLabel = new Date(form.created_at).toLocaleString("ru-RU");
  const deadlineLabel = form.deadline_at ? formatDashboardDeadlineLabel(form.deadline_at) : null;
  const hasReachedResponseLimit = isResponseLimitReached(responsesCount, form.max_responses);
  const stopCardEvent = (event: ReactMouseEvent) => event.stopPropagation();

  const metaItems = [
    !isTemplate && viewMode === "all" ? (
      <span key="author" className="dashboard-meta-item">
        {getAuthorLabel(form)}
      </span>
    ) : null,
    <span key="created" className="dashboard-meta-item">
      {createdAtLabel}
    </span>,
    deadlineLabel ? (
      <span key="deadline" className="dashboard-meta-item dashboard-meta-item-deadline">
        <img src={deadlineIcon} alt="" aria-hidden="true" className="dashboard-meta-icon" />
        <span>открыта до {deadlineLabel}</span>
      </span>
    ) : null,
    !isTemplate ? (
      <button
        key="responses"
        type="button"
        className={`dashboard-responses-link dashboard-responses-link-hitbox ${
          hasReachedResponseLimit ? "dashboard-responses-link-limit-reached" : ""
        }`.trim()}
        onClick={(event) => {
          stopCardEvent(event);
          onOpenResponses(form.id);
        }}
      >
        {getResponsesCounterLabel(responsesCount, form.max_responses)}
      </button>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="dashboard-form-meta-line">
      {metaItems.map((item, index) => (
        <div key={`${form.id}-meta-${index}`} className="dashboard-meta-inline-item">
          {index > 0 && (
            <span className="dashboard-meta-separator" aria-hidden="true">
              •
            </span>
          )}
          {item}
        </div>
      ))}
    </div>
  );
}
