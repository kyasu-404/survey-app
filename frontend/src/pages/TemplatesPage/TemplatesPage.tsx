import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import deleteIcon from "../../img/delete.svg";
import editIcon from "../../img/edit.svg";
import renameIcon from "../../img/rename.svg";
import refreshIcon from "../../img/refresh.png";
import shareIcon from "../../img/share.svg";
import useIcon from "../../img/use.svg";
import {
  changeFormStatus,
  getFormById,
  getTemplateFormsPage,
  removeForm,
  renameForm,
} from "../../entities/survey/api/surveysApi";
import {
  TEMPLATE_FORMS_QUERY_ROOT,
  getFormQueryKey,
  getSurveyFormQueryKey,
  getTemplateFormsQueryKey,
} from "../../entities/survey/model/queryKeys";
import { TEMPLATE_FORM_TYPE, getSurveyDisplayTitle, isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm, SurveyFormSummary } from "../../entities/survey/types";
import { getErrorMessage } from "../../shared/lib/error";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { saveSurveyBuilderDraft } from "../../widgets/SurveyBuilder/builderDraft";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";

type TemplatesSection = "mine" | "public";

type TemplateActionOptions = {
  actionKey: string;
  successMessage: string;
  errorMessage: string;
  affectedTemplateId?: string;
  shouldReloadTemplates?: boolean;
  logLabel: string;
};

type ListRefreshNavigationState = {
  refreshList?: boolean;
};

const TEMPLATE_PAGE_SIZE = 24;

function formatCreatedAt(dateTime: string) {
  return new Date(dateTime).toLocaleString("ru-RU");
}

function getAuthorLabel(form: SurveyFormSummary) {
  return form.author_name || form.author_email || form.author_id;
}

function renderTemplateSkeletonCards(count: number) {
  return Array.from({ length: count }, (_, index) => (
    <div key={`template-skeleton-${index}`} className="dashboard-form-skeleton templates-card-skeleton">
      <div className="dashboard-form-skeleton-header">
        <Skeleton className="dashboard-form-skeleton-pill" />
        <Skeleton className="dashboard-form-skeleton-menu" />
      </div>
      <Skeleton className="dashboard-form-skeleton-title" />
      <div className="dashboard-form-skeleton-meta">
        <Skeleton className="dashboard-form-skeleton-meta-pill dashboard-form-skeleton-meta-pill-wide" />
      </div>
    </div>
  ));
}

export default function TemplatesPage() {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const [section, setSection] = useState<TemplatesSection>("mine");
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_PAGE_SIZE);
  const [openedMenuTemplateId, setOpenedMenuTemplateId] = useState<string | null>(null);
  const [previewTemplateCard, setPreviewTemplateCard] = useState<SurveyFormSummary | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<SurveyFormSummary | null>(null);
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const templatesQueryKey = useMemo(
    () =>
      getTemplateFormsQueryKey({
        section,
        pageSize: visibleCount,
        userId: user?.id ?? null,
      }),
    [section, user?.id, visibleCount],
  );

  const {
    data: templatesPage,
    isLoading: isTemplatesLoading,
    isFetching: isTemplatesFetching,
    error: templatesError,
    refetch: reloadTemplates,
  } = useQuery({
    queryKey: templatesQueryKey,
    queryFn: () =>
      getTemplateFormsPage({
        page: 0,
        pageSize: visibleCount,
        filters:
          section === "mine"
            ? {
                authorId: user?.id,
                formType: TEMPLATE_FORM_TYPE,
              }
            : {
                formType: TEMPLATE_FORM_TYPE,
                isPublic: true,
              },
      }),
    enabled: !isAuthLoading && (section === "public" || Boolean(user?.id)),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  const templates = useMemo(() => {
    const templateForms = (templatesPage?.items ?? []).filter((form) => isTemplateForm(form));
    return section === "public" ? templateForms.filter((form) => form.is_public) : templateForms;
  }, [section, templatesPage?.items]);

  const {
    data: previewTemplate,
    isLoading: isPreviewTemplateLoading,
    error: previewTemplateError,
  } = useQuery({
    queryKey: getFormQueryKey(previewTemplateCard?.id),
    queryFn: () => getFormById(previewTemplateCard!.id),
    enabled: Boolean(previewTemplateCard?.id),
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  const isInitialTemplatesLoading = isTemplatesLoading && templates.length === 0;
  const hasMoreTemplates = templates.length < (templatesPage?.totalCount ?? templates.length);

  useEffect(() => {
    if (!templatesError) {
      return;
    }

    showToast(getErrorMessage(templatesError, "Не удалось загрузить шаблоны"), "error");
  }, [showToast, templatesError]);

  useEffect(() => {
    const shouldRefreshList =
      location.state &&
      typeof location.state === "object" &&
      (location.state as ListRefreshNavigationState).refreshList === true;

    if (!shouldRefreshList) {
      return;
    }

    if (isAuthLoading || (section === "mine" && !user?.id)) {
      return;
    }

    void reloadTemplates();
    navigate(location.pathname, { replace: true, state: null });
  }, [isAuthLoading, location.pathname, location.state, navigate, reloadTemplates, section, user?.id]);

  useEffect(() => {
    if (!previewTemplateError) {
      return;
    }

    showToast(getErrorMessage(previewTemplateError, "Не удалось загрузить шаблон"), "error");
  }, [previewTemplateError, showToast]);

  useEffect(() => {
    setVisibleCount(TEMPLATE_PAGE_SIZE);
    setPreviewTemplateCard(null);
  }, [section]);

  useEffect(() => {
    if (!openedMenuTemplateId) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".templates-floating-root")) {
        return;
      }

      setOpenedMenuTemplateId(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenuTemplateId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenuTemplateId]);

  const setActionPending = (actionKey: string, isPending: boolean) => {
    setPendingActionKeys((current) => {
      if (isPending) {
        return {
          ...current,
          [actionKey]: true,
        };
      }

      const nextState = { ...current };
      delete nextState[actionKey];
      return nextState;
    });
  };

  const getTemplateActionKey = (templateId: string) => `template:${templateId}`;
  const isTemplateActionPending = (templateId: string) => Boolean(pendingActionKeys[getTemplateActionKey(templateId)]);

  const scheduleTemplatesRefresh = () => {
    scheduleQueryInvalidation(queryClient, "templates refresh", [
      { queryKey: TEMPLATE_FORMS_QUERY_ROOT },
      { queryKey: ["builder-templates"] },
    ]);
  };

  const scheduleTemplateDetailsRefresh = (templateId: string) => {
    scheduleQueryInvalidation(queryClient, `template ${templateId} refresh`, [
      { queryKey: getFormQueryKey(templateId) },
      { queryKey: getSurveyFormQueryKey(templateId) },
    ]);
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameForm(id, title),
  });
  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeForm(id),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => changeFormStatus(id, isPublic),
  });
  const runAction = async (action: () => Promise<void>, options: TemplateActionOptions) => {
    setActionPending(options.actionKey, true);
    const stopPendingLogger = createPendingStateLogger(queryClient, options.logLabel);

    try {
      await action();
      if (options.affectedTemplateId) {
        scheduleTemplateDetailsRefresh(options.affectedTemplateId);
      }
      if (options.shouldReloadTemplates ?? true) {
        scheduleTemplatesRefresh();
      }
      showToast(options.successMessage, "success");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, options.errorMessage), "error");
    } finally {
      stopPendingLogger();
      setActionPending(options.actionKey, false);
    }
  };

  const stopCardEvent = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.stopPropagation();
  };

  const ensureTemplateDetails = async (templateId: string) => {
    return queryClient.fetchQuery({
      queryKey: ["form", templateId],
      queryFn: () => getFormById(templateId),
      staleTime: 60_000,
    });
  };

  const handleCardOpen = (template: SurveyFormSummary) => {
    setPreviewTemplateCard(template);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, template: SurveyFormSummary) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleCardOpen(template);
  };

  const handleRename = async (template: SurveyFormSummary) => {
    const newTitle = window.prompt("Введите новое название шаблона", template.title);
    if (!newTitle || !newTitle.trim() || newTitle === template.title) {
      return;
    }

    await runAction(() => renameMutation.mutateAsync({ id: template.id, title: newTitle.trim() }), {
      actionKey: getTemplateActionKey(template.id),
      successMessage: "Шаблон переименован",
      errorMessage: "Не удалось переименовать шаблон",
      affectedTemplateId: template.id,
      logLabel: `template rename ${template.id}`,
    });
  };

  const handleUseTemplate = async (template: SurveyFormSummary) => {
    if (!user?.id) {
      showToast("Для использования шаблона нужно войти в систему", "error");
      return;
    }

    const actionKey = getTemplateActionKey(template.id);
    setActionPending(actionKey, true);

    try {
      const fullTemplate = await ensureTemplateDetails(template.id);

      saveSurveyBuilderDraft(undefined, {
        ...fullTemplate.schema,
        title: fullTemplate.title,
      });
      showToast("Шаблон загружен в конструктор", "success");
      navigate(routes.builder);
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, "Не удалось загрузить шаблон в конструктор"), "error");
    } finally {
      setActionPending(actionKey, false);
    }
  };

  const handleToggleSharing = async (template: SurveyFormSummary) => {
    const nextStatus = !template.is_public;

    await runAction(() => statusMutation.mutateAsync({ id: template.id, isPublic: nextStatus }), {
      actionKey: getTemplateActionKey(template.id),
      successMessage: nextStatus ? "Шаблон опубликован" : "Шаблон скрыт",
      errorMessage: "Не удалось изменить доступность шаблона",
      affectedTemplateId: template.id,
      logLabel: `template share ${template.id}`,
    });
  };

  const confirmDelete = async () => {
    if (!templateToDelete) {
      return;
    }

    const deletingTemplate = templateToDelete;
    setTemplateToDelete(null);

    await runAction(() => removeMutation.mutateAsync({ id: deletingTemplate.id }), {
      actionKey: getTemplateActionKey(deletingTemplate.id),
      successMessage: "Шаблон удалён",
      errorMessage: "Не удалось удалить шаблон",
      affectedTemplateId: deletingTemplate.id,
      logLabel: `template delete ${deletingTemplate.id}`,
    });
  };

  const handleLoadMoreTemplates = () => {
    setVisibleCount((current) => current + TEMPLATE_PAGE_SIZE);
  };

  return (
    <div className="templates-page dashboard-shell">
      <div className="card dashboard-main-card templates-main-card">
        <div className="templates-page-header">
          <div>
            <p className="templates-page-kicker">Галерея</p>
            <h1 className="templates-page-title">Шаблоны</h1>
          </div>

          <div className="templates-page-actions">
            <div className="templates-segmented-control" role="tablist" aria-label="Раздел шаблонов">
              <button
                type="button"
                role="tab"
                className={section === "mine" ? "templates-segment templates-segment-active" : "templates-segment"}
                aria-selected={section === "mine"}
                onClick={() => setSection("mine")}
              >
                Мои
              </button>
              <button
                type="button"
                role="tab"
                className={section === "public" ? "templates-segment templates-segment-active" : "templates-segment"}
                aria-selected={section === "public"}
                onClick={() => setSection("public")}
              >
                Публичные
              </button>
            </div>
            <button
              type="button"
              className="dashboard-refresh-button"
              onClick={() => void reloadTemplates()}
              disabled={isTemplatesLoading || isTemplatesFetching}
            >
              {isTemplatesFetching ? (
                <InlineSpinner />
              ) : (
                <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              )}
              <span>{isTemplatesFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

        {isInitialTemplatesLoading && (
          <div className="templates-gallery-grid templates-gallery-grid-two-columns templates-gallery-grid-loading">
            {renderTemplateSkeletonCards(4)}
          </div>
        )}

        {!isInitialTemplatesLoading && templates.length === 0 && (
          <div className="dashboard-empty-state templates-empty-state">
            <h4>{section === "mine" ? "Шаблонов пока нет" : "Публичных шаблонов пока нет"}</h4>
            <p>
              {section === "mine"
                ? "Сохраните форму как шаблон в конструкторе, чтобы она появилась здесь."
                : "Когда пользователи поделятся шаблонами, они появятся в этой галерее."}
            </p>
          </div>
        )}

        <div
          className={`templates-gallery-grid templates-gallery-grid-two-columns ${
            openedMenuTemplateId ? "templates-gallery-grid-menu-open" : ""
          }`.trim()}
        >
          {templates.map((template) => {
            const title = getSurveyDisplayTitle(template);
            const isOwnTemplate = template.author_id === user?.id;
            const isCurrentTemplatePending = isTemplateActionPending(template.id);
            const actionMenuOpen = openedMenuTemplateId === template.id;
            const createdAtLabel = formatCreatedAt(template.created_at);
            const shareLabel = template.is_public ? "Не показывать другим" : "Поделиться";
            const templateActionMenu = isOwnTemplate ? (
              <div className="form-menu templates-floating-root templates-actions-menu-shell">
                <button
                  type="button"
                  className="form-menu-trigger"
                  aria-label={`Действия шаблона ${title}`}
                  aria-expanded={actionMenuOpen}
                  onClick={(event) => {
                    stopCardEvent(event);
                    setOpenedMenuTemplateId((current) => (current === template.id ? null : template.id));
                  }}
                  disabled={isCurrentTemplatePending}
                >
                  ...
                </button>

                {actionMenuOpen && (
                  <div
                    className="form-menu-dropdown templates-menu-dropdown"
                    role="menu"
                    aria-label={`Меню действий шаблона ${title}`}
                    onClick={stopCardEvent}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="form-menu-item"
                      onClick={(event) => {
                        stopCardEvent(event);
                        setOpenedMenuTemplateId(null);
                        void handleRename(template);
                      }}
                      disabled={isCurrentTemplatePending}
                    >
                      <img src={renameIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                      <span className="form-menu-item-label">Переименовать</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="form-menu-item"
                      onClick={(event) => {
                        stopCardEvent(event);
                        setOpenedMenuTemplateId(null);
                        navigate(routes.builderEdit(template.id));
                      }}
                      disabled={isCurrentTemplatePending}
                    >
                      <img src={editIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                      <span className="form-menu-item-label">Редактировать</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="form-menu-item form-menu-item-danger"
                      onClick={(event) => {
                        stopCardEvent(event);
                        setOpenedMenuTemplateId(null);
                        setTemplateToDelete(template);
                      }}
                      disabled={isCurrentTemplatePending}
                    >
                      <img src={deleteIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                      <span className="form-menu-item-label">Удалить</span>
                    </button>
                  </div>
                )}
              </div>
            ) : null;

            return (
              <div
                key={template.id}
                className={`dashboard-form-card dashboard-form-card-static templates-card ${
                  actionMenuOpen ? "dashboard-form-card-menu-open" : ""
                }`.trim()}
                role="button"
                tabIndex={0}
                aria-label={`Открыть превью шаблона ${title}`}
                onClick={() => handleCardOpen(template)}
                onKeyDown={(event) => handleCardKeyDown(event, template)}
              >
                <div className="templates-card-header">
                  <div className="dashboard-form-heading-row templates-card-title-row">
                    <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
                    <strong className="dashboard-form-title templates-card-title">{title}</strong>
                  </div>
                </div>

                <div className="templates-card-meta-line">
                  <span className="dashboard-meta-item">Создан {createdAtLabel}</span>
                  {section === "public" && (
                    <>
                      <span className="dashboard-meta-separator" aria-hidden="true">
                        •
                      </span>
                      <span className="templates-card-author">{getAuthorLabel(template)}</span>
                    </>
                  )}
                </div>

                <div className="templates-card-actions">
                  <div className="templates-card-button-row">
                    <button
                      type="button"
                      className="templates-use-button"
                      aria-label={`Использовать шаблон ${title}`}
                      onClick={(event) => {
                        stopCardEvent(event);
                        void handleUseTemplate(template);
                      }}
                      disabled={isCurrentTemplatePending}
                    >
                      <span>Использовать</span>
                      <img src={useIcon} alt="" aria-hidden="true" className="templates-action-icon" />
                    </button>

                    {isOwnTemplate && (
                      <button
                        type="button"
                        className={`templates-share-button ${template.is_public ? "templates-share-button-muted" : ""}`.trim()}
                        aria-label={`${shareLabel} шаблоном ${title}`}
                        onClick={(event) => {
                          stopCardEvent(event);
                          void handleToggleSharing(template);
                        }}
                        disabled={isCurrentTemplatePending}
                      >
                        <span>{shareLabel}</span>
                        <img src={shareIcon} alt="" aria-hidden="true" className="templates-action-icon" />
                      </button>
                    )}
                  </div>

                  {templateActionMenu}
                </div>
              </div>
            );
          })}
        </div>

        {!isInitialTemplatesLoading && hasMoreTemplates && (
          <div className="dashboard-load-more">
            <button type="button" className="dashboard-load-more-button" onClick={handleLoadMoreTemplates}>
              Показать ещё
            </button>
          </div>
        )}
      </div>

      {previewTemplateCard && (
        <div
          className="template-preview-layer"
          onMouseDown={(event) => event.target === event.currentTarget && setPreviewTemplateCard(null)}
        >
          <aside
            className="template-preview-drawer"
            role="dialog"
            aria-label={`Превью шаблона ${previewTemplateCard.title}`}
            aria-modal="true"
          >
            <div className="template-preview-header">
              <div>
                <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
                <h2 className="template-preview-title">{previewTemplateCard.title}</h2>
              </div>
              <button type="button" className="template-preview-close" onClick={() => setPreviewTemplateCard(null)}>
                Закрыть
              </button>
            </div>
            <div className="template-preview-body survey-page-card">
              {isPreviewTemplateLoading && (
                <div className="dashboard-forms-loading" role="status" aria-live="polite">
                  <span>Загрузка шаблона</span>
                  <InlineSpinner />
                </div>
              )}

              {previewTemplate && (
                <SurveyRenderer
                  schema={{
                    ...previewTemplate.schema,
                    title: previewTemplate.title,
                  }}
                  formId={previewTemplate.id}
                  isPreview
                />
              )}
            </div>
          </aside>
        </div>
      )}

      {templateToDelete && (
        <div className="modal-backdrop">
          <div className="modal-card card dashboard-delete-modal">
            <h3 className="dashboard-delete-modal-title">Удаление шаблона</h3>
            <p className="dashboard-delete-modal-copy">
              Удалить шаблон «{templateToDelete.title}»? Это действие нельзя отменить.
            </p>
            <div className="dashboard-delete-modal-actions">
              <button type="button" onClick={() => setTemplateToDelete(null)} disabled={isTemplateActionPending(templateToDelete.id)}>
                Отмена
              </button>
              <button
                type="button"
                className="dashboard-danger-button"
                onClick={() => void confirmDelete()}
                disabled={isTemplateActionPending(templateToDelete.id)}
              >
                {isTemplateActionPending(templateToDelete.id) && <InlineSpinner />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
