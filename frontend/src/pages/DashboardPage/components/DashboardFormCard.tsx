import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  SetStateAction,
} from "react";
import { getFormReasonLabel, getFormTypeLabel } from "../../../entities/survey/model/formOptions";
import { getSurveyDisplayTitle, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import type { DashboardViewMode, OpenMenuState } from "../types";
import { DashboardFormActionMenu } from "./DashboardFormActionMenu";
import { DashboardFormMetaLine } from "./DashboardFormMetaLine";
import { DashboardFormStatusControl } from "./DashboardFormStatusControl";

type DashboardFormCardProps = {
  currentUserId?: string;
  form: SurveyFormSummary;
  formIndex: number;
  isPending: boolean;
  onCopyLink: (formId: string) => void;
  onDeleteRequest: (form: SurveyFormSummary) => void;
  onDuplicate: (form: SurveyFormSummary) => void;
  onEditForm: (formId: string) => void;
  onOpenDeadlineEditor: (form: SurveyFormSummary) => void;
  onOpenForm: (form: SurveyFormSummary) => void;
  onOpenQrCode: (form: SurveyFormSummary) => void;
  onOpenResponseLimitEditor: (form: SurveyFormSummary) => void;
  onOpenResponses: (formId: string) => void;
  onRename: (form: SurveyFormSummary) => void;
  onToggleStatus: (form: SurveyFormSummary) => void;
  openedMenu: OpenMenuState;
  qrGeneratingFormId: string | null;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
  viewMode: DashboardViewMode;
};

export function DashboardFormCard({
  currentUserId,
  form,
  formIndex,
  isPending,
  onCopyLink,
  onDeleteRequest,
  onDuplicate,
  onEditForm,
  onOpenDeadlineEditor,
  onOpenForm,
  onOpenQrCode,
  onOpenResponseLimitEditor,
  onOpenResponses,
  onRename,
  onToggleStatus,
  openedMenu,
  qrGeneratingFormId,
  setOpenedMenu,
  viewMode,
}: DashboardFormCardProps) {
  const title = getSurveyDisplayTitle(form);
  const isOwnForm = form.author_id === currentUserId;
  const isTemplate = isTemplateForm(form);
  const actionMenuOpen = openedMenu?.kind === "actions" && openedMenu.formId === form.id;
  const statusMenuOpen = openedMenu?.kind === "status" && openedMenu.formId === form.id;
  const formTypeLabel = getFormTypeLabel(form.form_type);
  const formReasonLabel = getFormReasonLabel(form.form_reason);

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    onOpenForm(form);
  };

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
              <DashboardFormStatusControl
                form={form}
                isOwnForm={isOwnForm}
                isPending={isPending}
                onOpenDeadlineEditor={onOpenDeadlineEditor}
                onOpenResponseLimitEditor={onOpenResponseLimitEditor}
                onToggleStatus={onToggleStatus}
                setOpenedMenu={setOpenedMenu}
                statusMenuOpen={statusMenuOpen}
              />

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

        <DashboardFormActionMenu
          actionMenuOpen={actionMenuOpen}
          currentUserId={currentUserId}
          form={form}
          isFirstVisibleForm={formIndex === 0}
          isPending={isPending}
          onCopyLink={onCopyLink}
          onDeleteRequest={onDeleteRequest}
          onDuplicate={onDuplicate}
          onEditForm={onEditForm}
          onOpenQrCode={onOpenQrCode}
          onRename={onRename}
          qrGeneratingFormId={qrGeneratingFormId}
          setOpenedMenu={setOpenedMenu}
        />
      </div>
    </div>
  );
}
