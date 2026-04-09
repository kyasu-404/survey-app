import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import refreshIcon from "../../img/refresh.png";
import infoIcon from "../../img/info.svg";
import {
  changeFormStatus,
  cloneForm,
  getForms,
  removeForm,
  renameForm,
  setFormDeadline,
} from "../../entities/survey/api/surveysApi";
import { getNextDeadlineRefreshDelayMs } from "../../entities/survey/model/deadlineState";
import { getSurveyDisplayTitle, isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";

type DashboardPageProps = {
  viewMode: "mine" | "all";
};

type DeadlineEditorState = {
  form: SurveyForm;
  value: string;
};

type DashboardActionOptions = {
  actionKey: string;
  successMessage: string;
  errorMessage: string;
  shouldReloadForms?: boolean;
  affectedFormId?: string;
  logLabel: string;
};

type OpenMenuState =
  | { kind: "actions"; formId: string }
  | { kind: "status"; formId: string }
  | { kind: "stats" }
  | null;

const PAGE_SIZE_OPTIONS = [20, 50, 200] as const;
const MAX_TIMEOUT_MS = 2_147_483_647;

function formatDateTimeLocalValue(dateTime: string | null) {
  if (!dateTime) {
    return "";
  }

  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetInMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetInMs).toISOString().slice(0, 16);
}

function getResponsesLabel(count: number) {
  const absoluteCount = Math.abs(count);
  const mod10 = absoluteCount % 10;
  const mod100 = absoluteCount % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ответ`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ответа`;
  }

  return `${count} ответов`;
}

function getAuthorLabel(form: SurveyForm) {
  return form.author_name || form.author_email || form.author_id;
}

export default function DashboardPage({ viewMode }: DashboardPageProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState<"all" | "templates">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [visibleCount, setVisibleCount] = useState(20);
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});
  const [formToDelete, setFormToDelete] = useState<SurveyForm | null>(null);
  const [openedMenu, setOpenedMenu] = useState<OpenMenuState>(null);
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const formsQueryKey = useMemo(
    () => ["forms", { dateFrom, dateTo, viewMode, userId: user?.id ?? null }],
    [dateFrom, dateTo, user?.id, viewMode],
  );

  const {
    data: forms = [],
    isLoading: isFormsLoading,
    isFetching: isFormsFetching,
    error: formsError,
    refetch: reloadForms,
  } = useQuery({
    queryKey: formsQueryKey,
    queryFn: () =>
      getForms({
        dateFrom,
        dateTo,
        authorId: viewMode === "mine" ? user?.id : undefined,
      }),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(user?.id)),
    retry: 1,
  });

  const visibleForms = useMemo(() => {
    const formsForPage = viewMode === "all" ? forms.filter((form) => !isTemplateForm(form)) : forms;

    if (viewMode === "mine" && templateFilter === "templates") {
      return formsForPage.filter((form) => isTemplateForm(form));
    }

    return formsForPage;
  }, [forms, templateFilter, viewMode]);

  const filteredForms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return visibleForms;
    }

    return visibleForms.filter((form) => {
      const title = form.title?.toLowerCase() ?? "";
      const authorName = form.author_name?.toLowerCase() ?? "";
      const authorEmail = form.author_email?.toLowerCase() ?? "";
      const authorId = form.author_id?.toLowerCase() ?? "";

      return (
        title.includes(normalizedSearch) ||
        authorName.includes(normalizedSearch) ||
        authorEmail.includes(normalizedSearch) ||
        authorId.includes(normalizedSearch)
      );
    });
  }, [search, visibleForms]);

  const displayedForms = useMemo(() => filteredForms.slice(0, visibleCount), [filteredForms, visibleCount]);
  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const nextDeadlineRefreshDelayMs = useMemo(() => getNextDeadlineRefreshDelayMs(visibleForms), [visibleForms]);
  const isInitialFormsLoading = isFormsLoading && forms.length === 0;
  const activeFormsCount = useMemo(
    () => filteredForms.filter((form) => !isTemplateForm(form) && form.is_public).length,
    [filteredForms],
  );
  const formsWithDeadlineCount = useMemo(
    () => filteredForms.filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at)).length,
    [filteredForms],
  );
  const hasMoreForms = displayedForms.length < filteredForms.length;

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [dateFrom, dateTo, pageSize, search, templateFilter, viewMode]);

  useEffect(() => {
    if (formsError) {
      showToast(getErrorMessage(formsError, "Не удалось загрузить формы"), "error");
    }
  }, [formsError, showToast]);

  useEffect(() => {
    if (nextDeadlineRefreshDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void reloadForms();
    }, Math.min(nextDeadlineRefreshDelayMs + 250, MAX_TIMEOUT_MS));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [nextDeadlineRefreshDelayMs, reloadForms]);

  useEffect(() => {
    if (!openedMenu) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".dashboard-floating-root")) {
        return;
      }

      setOpenedMenu(null);
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenu]);

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

  const getFormActionKey = (formId: string) => `form:${formId}`;
  const isFormActionPending = (formId: string) => Boolean(pendingActionKeys[getFormActionKey(formId)]);

  const scheduleFormsRefresh = () => {
    scheduleQueryInvalidation(queryClient, "dashboard forms refresh", [{ queryKey: ["forms"] }]);
  };

  const scheduleFormDetailsRefresh = (formId: string) => {
    scheduleQueryInvalidation(queryClient, `dashboard form ${formId} refresh`, [
      { queryKey: ["form", formId] },
      { queryKey: ["survey-form", formId] },
      { queryKey: ["form-responses", formId] },
    ]);
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameForm(id, title),
  });
  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeForm(id),
  });
  const duplicateMutation = useMutation({
    mutationFn: ({ form, authorId }: { form: SurveyForm; authorId: string }) => cloneForm(form, authorId),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => changeFormStatus(id, isPublic),
  });
  const deadlineMutation = useMutation({
    mutationFn: ({ id, deadlineAt }: { id: string; deadlineAt: string | null }) => setFormDeadline(id, deadlineAt),
  });

  const runAction = async (action: () => Promise<void>, options: DashboardActionOptions) => {
    setActionPending(options.actionKey, true);
    const stopPendingLogger = createPendingStateLogger(queryClient, options.logLabel);

    try {
      await action();
      if (options.affectedFormId) {
        scheduleFormDetailsRefresh(options.affectedFormId);
      }
      if (options.shouldReloadForms ?? true) {
        scheduleFormsRefresh();
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

  const handleCopyLink = async (formId: string) => {
    try {
      const copied = await copyTextToClipboard(`${appOrigin}${routes.survey(formId)}`);
      if (!copied) {
        showToast("Автокопирование недоступно. Скопируйте ссылку вручную.", "warning");
        return;
      }
      showToast("Ссылка скопирована", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скопировать ссылку"), "error");
    }
  };

  const handleRename = async (form: SurveyForm) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) {
      return;
    }

    await runAction(() => renameMutation.mutateAsync({ id: form.id, title: newTitle.trim() }), {
      actionKey: getFormActionKey(form.id),
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось переименовать форму",
      affectedFormId: form.id,
      logLabel: `dashboard rename ${form.id}`,
    });
  };

  const confirmDelete = async () => {
    if (!formToDelete) {
      return;
    }

    const deletingForm = formToDelete;
    setFormToDelete(null);
    await runAction(() => removeMutation.mutateAsync({ id: deletingForm.id }), {
      actionKey: getFormActionKey(deletingForm.id),
      successMessage: "Форма удалена",
      errorMessage: "Не удалось удалить форму",
      affectedFormId: deletingForm.id,
      logLabel: `dashboard delete ${deletingForm.id}`,
    });
  };

  const handleDuplicate = async (form: SurveyForm) => {
    if (!user?.id) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(() => duplicateMutation.mutateAsync({ form, authorId: user.id }), {
      actionKey: getFormActionKey(form.id),
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось дублировать форму",
      logLabel: `dashboard duplicate ${form.id}`,
    });
  };

  const handleToggleFormStatus = async (form: SurveyForm) => {
    const nextStatus = !form.is_public;

    if (!nextStatus && form.deadline_at) {
      const shouldContinue = window.confirm(
        "Закрытие публичной формы приведёт к удалению текущего дедлайна. Вы хотите продолжить?",
      );

      if (!shouldContinue) {
        return;
      }
    }

    await runAction(async () => {
      if (!nextStatus && form.deadline_at) {
        await deadlineMutation.mutateAsync({ id: form.id, deadlineAt: null });
      }

      await statusMutation.mutateAsync({ id: form.id, isPublic: nextStatus });
    }, {
      actionKey: getFormActionKey(form.id),
      successMessage: nextStatus ? "Форма открыта" : "Форма закрыта",
      errorMessage: "Не удалось изменить статус формы",
      affectedFormId: form.id,
      logLabel: `dashboard status ${form.id}`,
    });
  };

  const handleCardOpen = (form: SurveyForm) => {
    if (isTemplateForm(form)) {
      return;
    }

    navigate(routes.survey(form.id));
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, form: SurveyForm) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleCardOpen(form);
  };

  const stopCardEvent = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="dashboard-page dashboard-shell">
      <div className="card dashboard-main-card">
        <div className="dashboard-toolbar">
          <div className="dashboard-search-group">
            <input
              className="dashboard-search-input"
              placeholder="Поиск по названию и автору"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="dashboard-floating-root dashboard-info-box">
              <button
                type="button"
                className="dashboard-info-button"
                aria-label="Статистика форм"
                aria-expanded={openedMenu?.kind === "stats"}
                onClick={() => setOpenedMenu((current) => (current?.kind === "stats" ? null : { kind: "stats" }))}
              >
                <img src={infoIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              </button>
              {openedMenu?.kind === "stats" && (
                <div className="dashboard-stats-popover" role="dialog" aria-label="Сводка по формам">
                  <div className="dashboard-stats-item">
                    <span>Всего форм</span>
                    <strong>{filteredForms.length}</strong>
                  </div>
                  <div className="dashboard-stats-item">
                    <span>Активных</span>
                    <strong>{activeFormsCount}</strong>
                  </div>
                  <div className="dashboard-stats-item">
                    <span>С дедлайном</span>
                    <strong>{formsWithDeadlineCount}</strong>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="dashboard-filter-group">
            <label className="dashboard-filter-field">
              <span>Дата с</span>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label className="dashboard-filter-field">
              <span>Дата по</span>
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            {viewMode === "mine" && (
              <label className="dashboard-filter-field">
                <span>Тип</span>
                <select aria-label="Тип форм" value={templateFilter} onChange={(event) => setTemplateFilter(event.target.value as "all" | "templates")}>
                  <option value="all">Все формы</option>
                  <option value="templates">Шаблоны</option>
                </select>
              </label>
            )}
            <label className="dashboard-filter-field">
              <span>Количество</span>
              <select
                aria-label="Количество форм"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="dashboard-refresh-button"
              onClick={() => void reloadForms()}
              disabled={isFormsLoading || isFormsFetching}
            >
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isFormsFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

        {isInitialFormsLoading && <p className="dashboard-loading-text">Загрузка...</p>}

        {!isInitialFormsLoading && filteredForms.length === 0 && (
          <div className="dashboard-empty-state">
            <h4>Форм пока нет</h4>
            <p>Попробуйте изменить фильтры или создайте новую форму в конструкторе.</p>
          </div>
        )}

        <div className="dashboard-forms-grid">
          {displayedForms.map((form) => {
            const title = getSurveyDisplayTitle(form);
            const isOwnForm = form.author_id === user?.id;
            const isTemplate = isTemplateForm(form);
            const isFormActive = form.is_public;
            const statusLabel = isTemplate ? "Шаблон" : isFormActive ? "Активна" : "Закрыта";
            const responsesCount = form.responses_count ?? 0;
            const isCurrentFormPending = isFormActionPending(form.id);
            const actionMenuOpen = openedMenu?.kind === "actions" && openedMenu.formId === form.id;
            const statusMenuOpen = openedMenu?.kind === "status" && openedMenu.formId === form.id;
            const createdAtLabel = new Date(form.created_at).toLocaleString("ru-RU");
            const deadlineLabel = form.deadline_at ? new Date(form.deadline_at).toLocaleString("ru-RU") : null;

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
                  открыта до {deadlineLabel}
                </span>
              ) : null,
              !isTemplate ? (
                <button
                  key="responses"
                  type="button"
                  className="dashboard-responses-link dashboard-responses-link-hitbox"
                  onClick={(event) => {
                    stopCardEvent(event);
                    navigate(routes.formResponses(form.id));
                  }}
                >
                  {getResponsesLabel(responsesCount)}
                </button>
              ) : null,
            ].filter(Boolean);

            const actionMenu = (
              <div className="form-menu dashboard-floating-root dashboard-actions-menu-shell">
                <button
                  type="button"
                  className="form-menu-trigger"
                  aria-label={`${isTemplate ? "Действия шаблона" : "Действия формы"} ${title}`}
                  aria-expanded={actionMenuOpen}
                  onClick={(event) => {
                    stopCardEvent(event);
                    setOpenedMenu((current) =>
                      current?.kind === "actions" && current.formId === form.id
                        ? null
                        : { kind: "actions", formId: form.id },
                    );
                  }}
                  disabled={isCurrentFormPending}
                >
                  ...
                </button>

                {actionMenuOpen && (
                  <div
                    className="form-menu-dropdown"
                    role="menu"
                    aria-label={`${isTemplate ? "Меню действий шаблона" : "Меню действий формы"} ${title}`}
                  >
                    {!isTemplate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="form-menu-item"
                        onClick={(event) => {
                          stopCardEvent(event);
                          setOpenedMenu(null);
                          void handleCopyLink(form.id);
                        }}
                        disabled={isCurrentFormPending}
                      >
                        Копировать ссылку
                      </button>
                    )}

                    {(isTemplate || isOwnForm) && (
                      <button
                        type="button"
                        role="menuitem"
                        className="form-menu-item"
                        onClick={(event) => {
                          stopCardEvent(event);
                          setOpenedMenu(null);
                          void handleRename(form);
                        }}
                        disabled={isCurrentFormPending}
                      >
                        Переименовать
                      </button>
                    )}

                    {isOwnForm && !isTemplate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="form-menu-item"
                        onClick={(event) => {
                          stopCardEvent(event);
                          setOpenedMenu(null);
                          navigate(routes.builderEdit(form.id));
                        }}
                        disabled={isCurrentFormPending}
                      >
                        Редактировать
                      </button>
                    )}

                    {!isTemplate && (
                      <button
                        type="button"
                        role="menuitem"
                        className="form-menu-item"
                        onClick={(event) => {
                          stopCardEvent(event);
                          setOpenedMenu(null);
                          void handleDuplicate(form);
                        }}
                        disabled={isCurrentFormPending}
                      >
                        Дублировать
                      </button>
                    )}

                    {(isTemplate || isOwnForm) && (
                      <button
                        type="button"
                        role="menuitem"
                        className="form-menu-item form-menu-item-danger"
                        onClick={(event) => {
                          stopCardEvent(event);
                          setOpenedMenu(null);
                          setFormToDelete(form);
                        }}
                        disabled={isCurrentFormPending}
                      >
                        Удалить
                      </button>
                    )}
                  </div>
                )}
              </div>
            );

            return (
              <div
                key={form.id}
                className={`dashboard-form-card ${!isTemplate ? "dashboard-form-card-interactive" : "dashboard-form-card-static"} ${
                  actionMenuOpen || statusMenuOpen ? "dashboard-form-card-menu-open" : ""
                }`.trim()}
                role={isTemplate ? undefined : "button"}
                tabIndex={isTemplate ? undefined : 0}
                aria-label={isTemplate ? undefined : `Открыть превью формы ${title}`}
                onClick={() => handleCardOpen(form)}
                onKeyDown={(event) => handleCardKeyDown(event, form)}
              >
                <div className="dashboard-form-header">
                  <div className="dashboard-form-heading">
                    <div className="dashboard-form-heading-row">
                      {isTemplate ? (
                        <span className="dashboard-status-pill dashboard-status-pill-template">Шаблон</span>
                      ) : isOwnForm ? (
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
                                current?.kind === "status" && current.formId === form.id
                                  ? null
                                  : { kind: "status", formId: form.id },
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
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className="form-menu-item"
                                onClick={(event) => {
                                  stopCardEvent(event);
                                  setOpenedMenu(null);
                                  void handleToggleFormStatus(form);
                                }}
                                disabled={isCurrentFormPending}
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
                                  setDeadlineEditor({ form, value: formatDateTimeLocalValue(form.deadline_at) });
                                }}
                                disabled={isCurrentFormPending}
                              >
                                Установить дедлайн
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span
                          className={`dashboard-status-pill ${
                            isFormActive ? "dashboard-status-pill-active" : "dashboard-status-pill-closed"
                          }`.trim()}
                        >
                          {statusLabel}
                        </span>
                      )}

                      <strong className="dashboard-form-title">{title}</strong>
                    </div>
                  </div>
                </div>

                <div className="dashboard-form-footer">
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

                  {actionMenu}
                </div>
              </div>
            );
          })}
        </div>

        {!isInitialFormsLoading && hasMoreForms && (
          <div className="dashboard-load-more">
            <button type="button" className="dashboard-load-more-button" onClick={() => setVisibleCount((current) => current + 20)}>
              Показать ещё
            </button>
          </div>
        )}
      </div>

      {deadlineEditor && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Дедлайн формы</h3>
            <p className="deadline-modal-subtitle">{deadlineEditor.form.title}</p>
            <label className="deadline-field">
              <span>Дата и время окончания</span>
              <input
                type="datetime-local"
                value={deadlineEditor.value}
                onChange={(event) =>
                  setDeadlineEditor((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
              />
            </label>
            <p className="deadline-modal-hint">
              При наступлении дедлайна форма автоматически закроется, а дедлайн снимется.
            </p>
            <div className="deadline-modal-actions">
              <button type="button" onClick={() => setDeadlineEditor(null)} disabled={isFormActionPending(deadlineEditor.form.id)}>
                Отмена
              </button>
              <button
                type="button"
                className="deadline-clear-button"
                onClick={() =>
                  runAction(
                    () => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: null }),
                    {
                      actionKey: getFormActionKey(deadlineEditor.form.id),
                      successMessage: "Дедлайн снят",
                      errorMessage: "Не удалось обновить дедлайн",
                      affectedFormId: deadlineEditor.form.id,
                      logLabel: `dashboard deadline clear ${deadlineEditor.form.id}`,
                    },
                  ).finally(() => setDeadlineEditor(null))
                }
                disabled={isFormActionPending(deadlineEditor.form.id)}
              >
                Снять дедлайн
              </button>
              <button
                type="button"
                onClick={() => {
                  const normalizedInput = deadlineEditor.value.trim();
                  if (!normalizedInput) {
                    showToast("Выберите дату и время или снимите дедлайн", "error");
                    return;
                  }

                  const parsedDate = new Date(normalizedInput);
                  if (Number.isNaN(parsedDate.getTime())) {
                    showToast("Некорректный формат даты дедлайна", "error");
                    return;
                  }

                  void runAction(
                    () => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: parsedDate.toISOString() }),
                    {
                      actionKey: getFormActionKey(deadlineEditor.form.id),
                      successMessage: "Дедлайн установлен",
                      errorMessage: "Не удалось обновить дедлайн",
                      affectedFormId: deadlineEditor.form.id,
                      logLabel: `dashboard deadline save ${deadlineEditor.form.id}`,
                    },
                  ).finally(() => setDeadlineEditor(null));
                }}
                disabled={isFormActionPending(deadlineEditor.form.id)}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {formToDelete && (
        <div className="modal-backdrop">
          <div className="modal-card card dashboard-delete-modal">
            <h3 className="dashboard-delete-modal-title">Удаление формы</h3>
            <p className="dashboard-delete-modal-copy">Удалить форму «{formToDelete.title}»? Это действие нельзя отменить.</p>
            <div className="dashboard-delete-modal-actions">
              <button type="button" onClick={() => setFormToDelete(null)} disabled={isFormActionPending(formToDelete.id)}>
                Отмена
              </button>
              <button
                type="button"
                className="dashboard-danger-button"
                onClick={() => void confirmDelete()}
                disabled={isFormActionPending(formToDelete.id)}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
