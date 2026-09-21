import type { Dispatch, SetStateAction } from "react";
import type { FormsSort, SurveyFormSummary } from "../../../entities/survey/types";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { DashboardLayout, DashboardViewMode, OpenMenuState } from "../types";
import { DashboardFormCard } from "./DashboardFormCard";

type DashboardFormsListProps = {
  layout: DashboardLayout;
  sort: FormsSort;
  onSort: (field: FormsSort["field"]) => void;
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
  layout,
  sort,
  onSort,
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
  const rows = displayedForms.map((form, formIndex) => (
          <DashboardFormCard
            key={form.id}
            layout={layout}
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
        ));

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

      <div className="dashboard-layout-transition" key={layout}>
      {layout === "cards" ? <div className="dashboard-forms-grid">{rows}</div> : (
        <div className="dashboard-forms-table-shell" role="region" aria-label="Список форм" tabIndex={0}>
          <table className="dashboard-forms-table">
            <thead><tr>
              {([
                ["status", "Статус"], ["title", "Название"], ["classification", "Тип / основание"],
                ["author_name", "Автор"], ["created_at", "Создано"], ["responses_count", "Ответы"],
              ] as const).filter(([field]) => viewMode !== "mine" || field !== "author_name").map(([field, label]) => (
                <th key={field} scope="col" aria-sort={sort.field === field ? sort.direction === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => onSort(field)} title={`Сортировать: ${label}`}>
                    {label}<span className="dashboard-sort-indicator" aria-hidden="true">{sort.field === field ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span>
                  </button>
                </th>
              ))}
              <th scope="col" aria-label="Действия" />
            </tr></thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      )}

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
