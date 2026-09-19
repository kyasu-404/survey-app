import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { FormsSort, SurveyFormSummary } from "../../entities/survey/types";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { DashboardFormsList } from "./components/DashboardFormsList";
import { DashboardToolbar } from "./components/DashboardToolbar";
import { DeadlineModal } from "./components/DeadlineModal";
import { DeleteFormModal } from "./components/DeleteFormModal";
import { QrModal } from "./components/QrModal";
import { ResponseLimitModal } from "./components/ResponseLimitModal";
import { useDashboardActions } from "./hooks/useDashboardActions";
import { useDashboardFilters } from "./hooks/useDashboardFilters";
import { useDashboardForms } from "./hooks/useDashboardForms";
import { useDashboardListRefresh } from "./hooks/useDashboardListRefresh";
import { useDashboardMenuDismiss } from "./hooks/useDashboardMenuDismiss";
import { useDashboardRealtime } from "./hooks/useDashboardRealtime";
import { useDashboardStats } from "./hooks/useDashboardStats";
import { useQrDialog } from "./hooks/useQrDialog";
import type { DashboardLayout, DashboardPageProps, OpenMenuState } from "./types";

export default function DashboardPage({ viewMode }: DashboardPageProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<DashboardLayout>(() => {
    try { return localStorage.getItem("survey-app:forms-layout") === "table" ? "table" : "cards"; }
    catch { return "cards"; }
  });
  const [sort, setSort] = useState<FormsSort>({ field: "created_at", direction: "desc" });
  const toggleLayout = () => {
    const next = layout === "cards" ? "table" : "cards";
    setLayout(next);
    setOpenedMenu(null);
    try { localStorage.setItem("survey-app:forms-layout", next); } catch { /* The view still works without storage. */ }
  };
  const changeSort = (field: FormsSort["field"]) => {
    setOpenedMenu(null);
    setSort((current) => ({
      field,
      direction: current.field === field
        ? current.direction === "asc" ? "desc" : "asc"
        : field === "created_at" || field === "responses_count" || field === "status" ? "desc" : "asc",
    }));
  };
  const [openedMenu, setOpenedMenu] = useState<OpenMenuState>(null);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const filters = useDashboardFilters(viewMode, user?.id);
  const forms = useDashboardForms({
    sort,
    filters,
    isAuthLoading,
    userId: user?.id,
    viewMode,
  });
  const stats = useDashboardStats({
    filteredForms: forms.filteredForms,
    loadedForms: forms.loadedForms,
    filters,
    isAuthLoading,
    loadedFormsTotalCount: forms.loadedFormsTotalCount,
    userId: user?.id,
    viewMode,
  });
  const actions = useDashboardActions({
    formsQueryKey: forms.formsQueryKey,
    formsStatsQueryKey: stats.formsStatsQueryKey,
    userId: user?.id,
  });
  const qr = useQrDialog();

  useDashboardRealtime({
    filters: filters.listFilters,
    formsQueryKey: forms.formsQueryKey,
    formsStatsQueryKey: stats.formsStatsQueryKey,
    isAuthLoading,
    queryClient,
    userId: user?.id,
    viewMode,
  });
  useDashboardListRefresh({
    isAuthLoading,
    isListFetching:
      forms.isInitialFormsLoading ||
      forms.isRefreshingForms ||
      forms.isBackgroundRefreshingForms ||
      forms.isFetchingNextFormsPage,
    listUpdatedAt: forms.formsUpdatedAt,
    reloadForms: forms.refreshFormsInBackground,
    userId: user?.id,
    viewMode,
  });
  useDashboardMenuDismiss(openedMenu, setOpenedMenu);

  useEffect(() => {
    if (forms.formsError && !isAbortError(forms.formsError)) {
      showToast(getErrorMessage(forms.formsError, "Не удалось загрузить формы"), "error");
    }
  }, [forms.formsError, showToast]);

  useEffect(() => {
    if (stats.statsError && !isAbortError(stats.statsError)) {
      showToast(getErrorMessage(stats.statsError, "Не удалось обновить статистику форм"), "error");
    }
  }, [showToast, stats.statsError]);

  const refreshDashboard = async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([forms.reloadForms(), stats.reloadStats()]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const handleCardOpen = (form: SurveyFormSummary) => {
    if (isTemplateForm(form)) {
      return;
    }

    navigate(routes.survey(form.id), { state: { renderMode: "preview-interactive" } });
  };

  return (
    <div className="dashboard-page dashboard-shell">
      <div className="card dashboard-main-card">
        <DashboardToolbar
          layout={layout}
          onToggleLayout={toggleLayout}
          activeFormsCount={stats.activeFormsCount}
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          formReason={filters.formReason}
          formType={filters.formType}
          formsUpdatedAt={forms.formsUpdatedAt}
          formsWithDeadlineCount={stats.formsWithDeadlineCount}
          isBackgroundRefreshingForms={forms.isBackgroundRefreshingForms}
          isInitialFormsLoading={forms.isInitialFormsLoading}
          isRefreshingForms={isManualRefreshing || forms.isRefreshingForms}
          onRefresh={() => void refreshDashboard()}
          openedMenu={openedMenu}
          search={filters.search}
          setDateFrom={filters.setDateFrom}
          setDateTo={filters.setDateTo}
          setFormReason={filters.setFormReason}
          setFormType={filters.setFormType}
          setOpenedMenu={setOpenedMenu}
          setSearch={filters.setSearch}
          totalFormsCount={stats.totalFormsCount}
          viewMode={viewMode}
        />

        <DashboardFormsList
          layout={layout}
          sort={sort}
          onSort={changeSort}
          currentUserId={user?.id}
          displayedForms={forms.displayedForms}
          filteredForms={forms.filteredForms}
          hasMoreForms={forms.hasMoreForms}
          isFetchingNextFormsPage={forms.isFetchingNextFormsPage}
          isFormActionPending={actions.isFormActionPending}
          isInitialFormsLoading={forms.isInitialFormsLoading}
          onCopyLink={(formId) => void qr.handleCopyLink(formId)}
          onDeleteRequest={actions.setFormToDelete}
          onDuplicate={(form) => void actions.handleDuplicate(form)}
          onEditForm={(formId) => navigate(routes.builderEdit(formId))}
          onLoadMore={forms.handleLoadMoreForms}
          onOpenDeadlineEditor={actions.openDeadlineEditor}
          onOpenForm={handleCardOpen}
          onOpenQrCode={(form) => void qr.handleOpenQrCode(form)}
          onOpenResponseLimitEditor={actions.openResponseLimitEditor}
          onOpenResponses={(formId) => navigate(routes.formResponses(formId))}
          onRename={(form) => void actions.handleRename(form)}
          onToggleStatus={(form) => void actions.handleToggleFormStatus(form)}
          openedMenu={openedMenu}
          qrGeneratingFormId={qr.qrGeneratingFormId}
          setOpenedMenu={setOpenedMenu}
          viewMode={viewMode}
        />
      </div>

      {actions.deadlineEditor && (
        <DeadlineModal
          editor={actions.deadlineEditor}
          isPending={actions.isFormActionPending(actions.deadlineEditor.form.id)}
          onCancel={() => actions.setDeadlineEditor(null)}
          onClear={() => void actions.clearDeadline()}
          onSave={() => void actions.saveDeadline()}
          onValueChange={actions.updateDeadlineEditorValue}
        />
      )}

      {actions.responseLimitEditor && (
        <ResponseLimitModal
          editor={actions.responseLimitEditor}
          isPending={actions.isFormActionPending(actions.responseLimitEditor.form.id)}
          onCancel={() => actions.setResponseLimitEditor(null)}
          onClear={() => void actions.clearResponseLimit()}
          onSave={() => void actions.saveResponseLimit()}
          onValueChange={actions.updateResponseLimitEditorValue}
        />
      )}

      {actions.formToDelete && (
        <DeleteFormModal
          form={actions.formToDelete}
          isPending={actions.isFormActionPending(actions.formToDelete.id)}
          onCancel={() => actions.setFormToDelete(null)}
          onConfirm={() => void actions.confirmDelete()}
        />
      )}

      {qr.qrDialog && (
        <QrModal
          downloadFormat={qr.qrDownloadFormat}
          onClose={() => qr.setQrDialog(null)}
          onDownload={(format) => void qr.handleDownloadQr(format)}
          qrDialog={qr.qrDialog}
        />
      )}
    </div>
  );
}
