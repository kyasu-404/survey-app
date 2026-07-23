import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import type { SurveyFormSummary } from "../../entities/survey/types";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { TemplateDeleteModal } from "./components/TemplateDeleteModal";
import { TemplatePreviewModal } from "./components/TemplatePreviewModal";
import { TemplateSkeletonCards } from "./components/TemplateSkeletonCards";
import { TemplatesGrid } from "./components/TemplatesGrid";
import { TemplatesSectionTabs } from "./components/TemplatesSectionTabs";
import { usePinnedTemplates } from "./hooks/usePinnedTemplates";
import { useTemplateActions } from "./hooks/useTemplateActions";
import { useTemplatePreview } from "./hooks/useTemplatePreview";
import { useTemplatesData } from "./hooks/useTemplatesData";
import { useTemplatesListRefresh } from "./hooks/useTemplatesListRefresh";
import { useTemplatesMenuDismiss } from "./hooks/useTemplatesMenuDismiss";
import type { TemplatesSection } from "./types";

export default function TemplatesPage() {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [section, setSection] = useState<TemplatesSection>("mine");
  const [openedMenuTemplateId, setOpenedMenuTemplateId] = useState<string | null>(null);
  const [previewTemplateCard, setPreviewTemplateCard] = useState<SurveyFormSummary | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<SurveyFormSummary | null>(null);
  const templatesData = useTemplatesData({ isAuthLoading, section, userId: user?.id });
  const pinnedTemplates = usePinnedTemplates(section, user?.id, templatesData.templates);
  const previewQuery = useTemplatePreview(previewTemplateCard);
  const templateActions = useTemplateActions(user?.id);

  useTemplatesListRefresh({
    isAuthLoading,
    isListFetching:
      templatesData.isInitialTemplatesLoading ||
      templatesData.isRefreshingTemplates ||
      templatesData.isFetchingNextTemplatesPage,
    listUpdatedAt: templatesData.templatesUpdatedAt,
    reloadTemplates: templatesData.reloadTemplates,
    section,
    userId: user?.id,
  });
  useTemplatesMenuDismiss(openedMenuTemplateId, setOpenedMenuTemplateId);

  useEffect(() => {
    if (!templatesData.templatesError || isAbortError(templatesData.templatesError)) {
      return;
    }

    showToast(getErrorMessage(templatesData.templatesError, "Не удалось загрузить шаблоны"), "error");
  }, [showToast, templatesData.templatesError]);

  useEffect(() => {
    if (!previewQuery.error || isAbortError(previewQuery.error)) {
      return;
    }

    showToast(getErrorMessage(previewQuery.error, "Не удалось загрузить шаблон"), "error");
  }, [previewQuery.error, showToast]);

  useEffect(() => {
    setPreviewTemplateCard(null);
  }, [section]);

  const handleLoadMoreTemplates = () => {
    if (!templatesData.hasMoreTemplates || templatesData.isFetchingNextTemplatesPage) {
      return;
    }

    void templatesData.loadNextTemplatesPage();
  };

  const confirmDelete = async () => {
    if (!templateToDelete) {
      return;
    }

    const deletingTemplate = templateToDelete;
    setTemplateToDelete(null);
    await templateActions.confirmDelete(deletingTemplate);
  };

  return (
    <div className="templates-page dashboard-shell">
      <div className="card dashboard-main-card templates-main-card">
        <div className="templates-page-header">
          <div>
            <p className="templates-page-kicker">Галерея</p>
            <h1 className="templates-page-title">Шаблоны</h1>
          </div>

          <TemplatesSectionTabs
            isInitialLoading={templatesData.isInitialTemplatesLoading}
            isRefreshing={templatesData.isRefreshingTemplates}
            lastUpdatedAt={templatesData.templatesUpdatedAt}
            onRefresh={() => void templatesData.reloadTemplates()}
            onSectionChange={setSection}
            section={section}
          />
        </div>

        {templatesData.isInitialTemplatesLoading && (
          <div className="templates-gallery-grid templates-gallery-grid-two-columns templates-gallery-grid-loading">
            <TemplateSkeletonCards count={4} />
          </div>
        )}

        {!templatesData.isInitialTemplatesLoading && templatesData.templates.length === 0 && (
          <div className="dashboard-empty-state templates-empty-state">
            <h4>{section === "mine" ? "Шаблонов пока нет" : "Публичных шаблонов пока нет"}</h4>
            <p>
              {section === "mine"
                ? "Сохраните форму как шаблон в конструкторе, чтобы она появилась здесь."
                : "Когда пользователи поделятся шаблонами, они появятся в этой галерее."}
            </p>
          </div>
        )}

        <TemplatesGrid
          currentUserId={user?.id}
          isTemplateActionPending={templateActions.isTemplateActionPending}
          onDeleteRequest={setTemplateToDelete}
          onEditTemplate={(path) => navigate(path)}
          onOpenTemplate={setPreviewTemplateCard}
          onRename={(template) => void templateActions.handleRename(template)}
          onTogglePin={pinnedTemplates.handleTogglePin}
          onToggleSharing={(template) => void templateActions.handleToggleSharing(template)}
          onUseTemplate={(template) => void templateActions.handleUseTemplate(template)}
          openedMenuTemplateId={openedMenuTemplateId}
          pinnedTemplateIds={pinnedTemplates.pinnedTemplateIds}
          section={section}
          setOpenedMenuTemplateId={setOpenedMenuTemplateId}
          templates={pinnedTemplates.sortedTemplates}
        />

        {!templatesData.isInitialTemplatesLoading && templatesData.hasMoreTemplates && (
          <div className="dashboard-load-more">
            <button
              type="button"
              className="dashboard-load-more-button"
              onClick={handleLoadMoreTemplates}
              disabled={templatesData.isFetchingNextTemplatesPage}
            >
              {templatesData.isFetchingNextTemplatesPage ? "Загрузка..." : "Показать ещё"}
            </button>
          </div>
        )}
      </div>

      {previewTemplateCard && (
        <TemplatePreviewModal
          isLoading={previewQuery.isLoading}
          onClose={() => setPreviewTemplateCard(null)}
          previewTemplate={previewQuery.data}
          previewTemplateCard={previewTemplateCard}
        />
      )}

      {templateToDelete && (
        <TemplateDeleteModal
          isPending={templateActions.isTemplateActionPending(templateToDelete.id)}
          onCancel={() => setTemplateToDelete(null)}
          onConfirm={() => void confirmDelete()}
          template={templateToDelete}
        />
      )}
    </div>
  );
}
