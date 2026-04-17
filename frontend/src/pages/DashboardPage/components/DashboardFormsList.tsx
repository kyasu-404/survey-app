import type { Dispatch, SetStateAction } from "react";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { DashboardViewMode, OpenMenuState } from "../types";
import { DashboardFormCard } from "./DashboardFormCard";

type DashboardFormsListProps = {
  currentUserId?: string;
  displayedForms: SurveyFormSummary[];
  filteredForms: SurveyFormSummary[];
  hasMoreForms: boolean;
  isFetchingNextFormsPage: boolean;
  isFormActionPending: (formId: string) => boolean;
  isInitialFormsLoading: boolean;
  onCopyLink: (formId: string) => void;
  onDeleteRequest: (form: SurveyFormSummary) => void;
  onDuplicate: (form: SurveyFormSummary) => void;
  onEditForm: (formId: string) => void;
  onLoadMore: () => void;
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

export function DashboardFormsList({
  currentUserId,
  displayedForms,
  filteredForms,
  hasMoreForms,
  isFetchingNextFormsPage,
  isFormActionPending,
  isInitialFormsLoading,
  onCopyLink,
  onDeleteRequest,
  onDuplicate,
  onEditForm,
  onLoadMore,
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
}: DashboardFormsListProps) {
  return (
    <>
      {isInitialFormsLoading && (
        <div className="dashboard-forms-loading" role="status" aria-live="polite">
          <span>Загрузка форм</span>
          <InlineSpinner />
        </div>
      )}

      {!isInitialFormsLoading && filteredForms.length === 0 && (
        <div className="dashboard-empty-state">
          <h4>Форм пока нет</h4>
          <p>Попробуйте изменить фильтры или создайте новую форму в конструкторе.</p>
        </div>
      )}

      <div className="dashboard-forms-grid">
        {displayedForms.map((form, formIndex) => (
          <DashboardFormCard
            key={form.id}
            currentUserId={currentUserId}
            form={form}
            formIndex={formIndex}
            isPending={isFormActionPending(form.id)}
            onCopyLink={onCopyLink}
            onDeleteRequest={onDeleteRequest}
            onDuplicate={onDuplicate}
            onEditForm={onEditForm}
            onOpenDeadlineEditor={onOpenDeadlineEditor}
            onOpenForm={onOpenForm}
            onOpenQrCode={onOpenQrCode}
            onOpenResponseLimitEditor={onOpenResponseLimitEditor}
            onOpenResponses={onOpenResponses}
            onRename={onRename}
            onToggleStatus={onToggleStatus}
            openedMenu={openedMenu}
            qrGeneratingFormId={qrGeneratingFormId}
            setOpenedMenu={setOpenedMenu}
            viewMode={viewMode}
          />
        ))}
      </div>

      {!isInitialFormsLoading && hasMoreForms && (
        <div className="dashboard-load-more">
          <button type="button" className="dashboard-load-more-button" onClick={onLoadMore} disabled={isFetchingNextFormsPage}>
            {isFetchingNextFormsPage ? "Загрузка..." : "Показать ещё"}
          </button>
        </div>
      )}
    </>
  );
}
