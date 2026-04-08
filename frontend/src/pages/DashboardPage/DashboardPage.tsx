import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getResponsesByForm } from "../../entities/response/api";
import { formatResponsesForTable } from "../../entities/response/model/responseTable";
import activeStatusIcon from "../../img/active.svg";
import closedStatusIcon from "../../img/closed.svg";
import copyIcon from "../../img/copy.svg";
import copyLinkIcon from "../../img/copy_link.svg";
import deadlineIcon from "../../img/deadline.svg";
import infoIcon from "../../img/info.svg";
import refreshIcon from "../../img/refresh.png";
import xlsIcon from "../../img/xls.png";
import {
  changeFormStatus,
  cloneForm,
  getForms,
  removeForm,
  renameForm,
  setFormDeadline,
} from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle, isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";
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

type MenuPlacement = "side" | "up";

function isFormAcceptingResponses(form: Pick<SurveyForm, "is_public" | "deadline_at" | "form_type">, now = Date.now()) {
  if (isTemplateForm(form)) {
    return false;
  }

  if (!form.is_public) {
    return false;
  }

  if (!form.deadline_at) {
    return true;
  }

  return !isFormDeadlineExpired(form, now);
}

function isFormDeadlineExpired(form: Pick<SurveyForm, "deadline_at">, now = Date.now()) {
  if (!form.deadline_at) {
    return false;
  }

  const deadlineTime = new Date(form.deadline_at).getTime();

  if (Number.isNaN(deadlineTime)) {
    return false;
  }

  return deadlineTime <= now;
}

function isFormEffectivelyActive(form: Pick<SurveyForm, "is_public" | "deadline_at" | "form_type">, now = Date.now()) {
  if (!form.is_public || isTemplateForm(form)) {
    return false;
  }

  return !isFormDeadlineExpired(form, now);
}

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

function formatDashboardDate(dateTime: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateTime));
}

export default function DashboardPage({ viewMode }: DashboardPageProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "closed">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isStatsInfoOpen, setIsStatsInfoOpen] = useState(false);
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});
  const [formToDelete, setFormToDelete] = useState<SurveyForm | null>(null);
  const [openedMenuFormId, setOpenedMenuFormId] = useState<string | null>(null);
  const [openedMenuPlacement, setOpenedMenuPlacement] = useState<MenuPlacement>("side");
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
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

  const visibleForms = useMemo(
    () => (viewMode === "all" ? forms.filter((form) => !isTemplateForm(form)) : forms),
    [forms, viewMode],
  );

  const filteredForms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return visibleForms.filter((form) => {
      const title = form.title?.toLowerCase() ?? "";
      const authorName = form.author_name?.toLowerCase() ?? "";
      const authorEmail = form.author_email?.toLowerCase() ?? "";
      const authorId = form.author_id?.toLowerCase() ?? "";
      const matchesSearch =
        !normalizedSearch ||
        title.includes(normalizedSearch) ||
        authorName.includes(normalizedSearch) ||
        authorEmail.includes(normalizedSearch) ||
        authorId.includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isFormEffectivelyActive(form, currentTime)) ||
        (statusFilter === "closed" && !isFormEffectivelyActive(form, currentTime));

      return matchesSearch && matchesStatus;
    });
  }, [currentTime, search, statusFilter, visibleForms]);

  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const showAuthorColumn = viewMode !== "mine";
  const isInitialFormsLoading = isFormsLoading && forms.length === 0;
  const activeFormsCount = useMemo(() => filteredForms.filter((form) => isFormEffectivelyActive(form, currentTime)).length, [currentTime, filteredForms]);
  const formsWithDeadlineCount = useMemo(() => filteredForms.filter((form) => Boolean(form.deadline_at) && !isFormDeadlineExpired(form, currentTime)).length, [currentTime, filteredForms]);
  const nearestDeadlineForms = useMemo(
    () =>
      [...visibleForms]
        .filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at) && isFormAcceptingResponses(form, currentTime))
        .sort((left, right) => new Date(left.deadline_at ?? "").getTime() - new Date(right.deadline_at ?? "").getTime())
        .slice(0, 4),
    [currentTime, visibleForms],
  );
  const recentForms = useMemo(
    () =>
      [...visibleForms]
        .filter((form) => !isTemplateForm(form))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
        .slice(0, 4),
    [visibleForms],
  );

  useEffect(() => {
    if (formsError) {
      showToast(getErrorMessage(formsError, "Не удалось загрузить формы"), "error");
    }
  }, [formsError, showToast]);

  useEffect(() => {
    if (!openedMenuFormId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".form-menu")) {
        return;
      }

      setOpenedMenuFormId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenuFormId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenuFormId]);

  useEffect(() => {
    const upcomingDeadlines = forms
      .filter((form) => !isTemplateForm(form) && form.is_public)
      .map((form) => (form.deadline_at ? new Date(form.deadline_at).getTime() : Number.NaN))
      .filter((deadlineTime) => !Number.isNaN(deadlineTime) && deadlineTime > currentTime);

    if (!upcomingDeadlines.length) {
      return;
    }

    const nextDeadlineTime = Math.min(...upcomingDeadlines);
    const timeoutId = window.setTimeout(() => {
      setCurrentTime(Date.now());
    }, Math.max(nextDeadlineTime - currentTime, 0) + 1);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentTime, forms]);

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

  const runAction = async (
    action: () => Promise<void>,
    options: DashboardActionOptions,
  ) => {
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

  const handleCopyLink = async (link: string) => {
    try {
      const copied = await copyTextToClipboard(link);
      if (!copied) {
        showToast("Автокопирование недоступно. Скопируйте ссылку вручную.", "info");
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
    await runAction(() => statusMutation.mutateAsync({ id: form.id, isPublic: nextStatus }), {
      actionKey: getFormActionKey(form.id),
      successMessage: nextStatus ? "Форма активирована" : "Форма закрыта",
      errorMessage: "Не удалось изменить статус формы",
      affectedFormId: form.id,
      logLabel: `dashboard status ${form.id}`,
    });
  };

  const handleExportResponses = async (form: SurveyForm) => {
    try {
      const responses = await queryClient.fetchQuery({
        queryKey: ["form-responses", form.id],
        queryFn: () => getResponsesByForm(form.id),
      });
      const tableRows = formatResponsesForTable(responses, form.schema);
      if (!tableRows.length) {
        showToast("Нет данных для выгрузки", "info");
        return;
      }
      exportToExcel(tableRows, `ответы-${form.title}`);
      showToast("Ответы выгружены в XLSX", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось выгрузить ответы"), "error");
    }
  };

  const handleOpenForm = (form: SurveyForm) => {
    if (!isFormAcceptingResponses(form, currentTime)) {
      showToast(
        isFormDeadlineExpired(form, currentTime)
          ? "Ссылка недоступна: дедлайн формы уже истёк"
          : "Ссылка закрыта: форма неактивна",
        "info",
      );
      return;
    }

    navigate(`${routes.survey(form.id)}?mode=preview`);
  };

  const getMenuPlacement = (triggerElement: HTMLElement, itemCount: number): MenuPlacement => {
    const triggerRect = triggerElement.getBoundingClientRect();
    const estimatedMenuHeight = itemCount * 42 + 16;
    const availableSpaceBelow = window.innerHeight - triggerRect.bottom;

    if (availableSpaceBelow < estimatedMenuHeight && triggerRect.top > estimatedMenuHeight / 2) {
      return "up";
    }

    return "side";
  };

  return (
    <div className="dashboard-page dashboard-shell command-center-page">
      <section className="card dashboard-hero command-center-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker">{viewMode === "mine" ? "Мои формы" : "Все формы"}</span>
          <h1 className="dashboard-title">Командный центр форм</h1>
          <p className="dashboard-subtitle">
            Следите за дедлайнами, быстрыми действиями и последними формами из одного рабочего пространства.
          </p>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat-card"><span>Всего форм</span><strong>{filteredForms.length}</strong></div>
          <div className="dashboard-stat-card"><span>Активные</span><strong>{activeFormsCount}</strong></div>
          <div className="dashboard-stat-card"><span>С дедлайном</span><strong>{formsWithDeadlineCount}</strong></div>
        </div>
      </section>

      <div className="command-center-grid">
        <section className="card dashboard-module">
          <div className="dashboard-module-header">
            <h2>Ближайшие дедлайны</h2>
            <span>{nearestDeadlineForms.length || "Нет активных дедлайнов"}</span>
          </div>
          <div className="dashboard-priority-list">
            {nearestDeadlineForms.map((form) => (
              <button key={form.id} className="dashboard-priority-item" onClick={() => handleOpenForm(form)}>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <span>{form.deadline_at ? formatDashboardDate(form.deadline_at) : "Без дедлайна"}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card dashboard-module">
          <div className="dashboard-module-header">
            <h2>Недавние формы</h2>
            <span>{recentForms.length}</span>
          </div>
          <div className="dashboard-priority-list">
            {recentForms.map((form) => (
              <button key={form.id} className="dashboard-priority-item" onClick={() => handleOpenForm(form)}>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <span>{formatDashboardDate(form.created_at)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="card dashboard-main-card dashboard-workspace-card">
        <div className="dashboard-toolbar">
          <input
            className="dashboard-search-input"
            placeholder="Поиск по названию и автору"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="dashboard-filter-group">
            <label className="dashboard-filter-field">
              <span>Статус</span>
              <select aria-label="Статус" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "closed")}>
                <option value="all">Все</option>
                <option value="active">Активные</option>
                <option value="closed">Закрытые</option>
              </select>
            </label>
            <label className="dashboard-filter-field">
              <span>Дата с</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="dashboard-filter-field">
              <span>Дата по</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <button className="dashboard-refresh-button" onClick={() => void reloadForms()} disabled={isFormsLoading || isFormsFetching}>
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isFormsFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
            <div className="dashboard-toolbar-info">
              <button
                className="dashboard-table-action-button"
                onClick={() => setIsStatsInfoOpen((current) => !current)}
                aria-label="Показать статистику"
                title="Показать статистику"
                aria-expanded={isStatsInfoOpen}
              >
                <img src={infoIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
              </button>
              {isStatsInfoOpen && (
                <div className="dashboard-toolbar-info-popover">
                  <p>Всего форм: {filteredForms.length}</p>
                  <p>Активных: {activeFormsCount}</p>
                  <p>С дедлайном: {formsWithDeadlineCount}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {isInitialFormsLoading && <p className="dashboard-loading-text">Загрузка...</p>}
        {!isInitialFormsLoading && filteredForms.length === 0 && (
          <div className="dashboard-empty-state">
            <h4>Форм пока нет</h4>
            <p>Попробуйте изменить фильтры или создайте новую форму в конструкторе.</p>
          </div>
        )}

        <div className="dashboard-forms-table-wrapper">
          <table className="dashboard-forms-table">
            <thead>
              <tr>
                <th scope="col">Статус</th>
                {showAuthorColumn && <th scope="col">Автор</th>}
                <th scope="col">Название</th>
                <th scope="col">Дата</th>
                <th scope="col">Ответы</th>
                <th scope="col" aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filteredForms.map((form) => {
                const link = `${appOrigin}${routes.survey(form.id)}`;
                const authorLabel = form.author_name || form.author_email || form.author_id || "Не указан";
                const responsesCount = isTemplateForm(form) ? "—" : String(form.responses_count ?? 0);
                const isFormActive = isFormEffectivelyActive(form, currentTime);
                const isOwnForm = form.author_id === user?.id;
                const isTemplate = isTemplateForm(form);
                const isFormOpenForResponses = isFormAcceptingResponses(form, currentTime);
                const deadlineLabel = form.deadline_at && !isFormDeadlineExpired(form, currentTime) ? formatDashboardDate(form.deadline_at) : null;
                const statusLabel = !isTemplate && isFormActive ? "Активна" : "Закрыта";
                const statusIcon = !isTemplate && isFormActive ? activeStatusIcon : closedStatusIcon;
                const isCurrentFormPending = isFormActionPending(form.id);
                const menuItemCount = isTemplate ? 2 : isOwnForm ? 5 : 0;

                return (
                  <tr
                    key={form.id}
                    className={`dashboard-table-row ${isOwnForm ? "dashboard-table-row-own" : ""} ${openedMenuFormId === form.id ? "dashboard-form-card-menu-open" : ""}`.trim()}
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("button, a, input, select, textarea, label")) {
                        return;
                      }

                      if (!isTemplate) {
                        handleOpenForm(form);
                      }
                    }}
                  >
                    <td className="dashboard-table-status-cell">
                      <div className="dashboard-table-status-content">
                        {isTemplate ? (
                          <span className="dashboard-table-template-badge">Шаблон</span>
                        ) : isOwnForm ? (
                          <button
                            className="dashboard-status-cell-button"
                            onClick={() => void handleToggleFormStatus(form)}
                            disabled={isCurrentFormPending}
                            aria-label={statusLabel}
                            title={statusLabel}
                          >
                            <img src={statusIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
                          </button>
                        ) : (
                          <span className="dashboard-status-icon" title={statusLabel}>
                            <img src={statusIcon} alt={statusLabel} className="dashboard-table-action-icon" />
                          </span>
                        )}
                      </div>
                    </td>
                    {showAuthorColumn && (
                      <td className={`dashboard-table-author-cell ${isOwnForm ? "dashboard-table-author-cell-own" : ""}`.trim()}>{authorLabel}</td>
                    )}
                    <td className="dashboard-table-title-cell">
                      <strong className="dashboard-table-title">{getSurveyDisplayTitle(form)}</strong>
                    </td>
                    <td>
                      <div className="dashboard-table-date-cell">
                        <div className="dashboard-table-date-details">
                          <span className="dashboard-table-date-value">{formatDashboardDate(form.created_at)}</span>
                          {!isTemplate && deadlineLabel && (
                            <span className="dashboard-table-date-meta">
                              Дедлайн: <span className="dashboard-table-deadline-value">{deadlineLabel}</span>
                            </span>
                          )}
                        </div>
                        {isOwnForm && !isTemplate && (
                          <button
                            className="dashboard-table-action-button"
                            onClick={() => setDeadlineEditor({ form, value: formatDateTimeLocalValue(form.deadline_at) })}
                            disabled={isCurrentFormPending}
                            aria-label="Установить дедлайн"
                            title="Установить дедлайн"
                          >
                            <img src={deadlineIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="dashboard-table-responses-cell">
                      {!isTemplate ? (
                        <Link
                          className="dashboard-table-responses-button"
                          to={routes.formResponses(form.id)}
                          aria-label="Показать ответы"
                          title="Показать ответы"
                        >
                          <span className={(form.responses_count ?? 0) > 0 ? "dashboard-table-responses-value dashboard-table-responses-value-positive" : "dashboard-table-responses-value"}>
                            {responsesCount}
                          </span>
                        </Link>
                      ) : (
                        <span className="dashboard-table-responses-value">{responsesCount}</span>
                      )}
                    </td>
                    <td>
                      <div className="dashboard-table-actions">
                        {!isTemplate && (
                          <>
                            <button
                              className="dashboard-table-action-button"
                              onClick={() => void handleCopyLink(link)}
                              disabled={!isFormOpenForResponses}
                              aria-label="Скопировать ссылку"
                              title="Скопировать ссылку"
                            >
                              <img src={copyLinkIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
                            </button>
                            {!isOwnForm && (
                            <button
                              className="dashboard-table-action-button"
                              onClick={() => void handleDuplicate(form)}
                              disabled={isCurrentFormPending}
                              aria-label="Дублировать"
                                title="Дублировать"
                              >
                                <img src={copyIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
                              </button>
                            )}
                            {!isOwnForm && (
                              <button
                                className="dashboard-table-action-button"
                                onClick={() => void handleExportResponses(form)}
                                disabled={isCurrentFormPending}
                                aria-label="Выгрузить в XLSX"
                                title="Выгрузить в XLSX"
                              >
                                <img src={xlsIcon} alt="" aria-hidden="true" className="dashboard-table-action-icon" />
                              </button>
                            )}
                          </>
                        )}

                        {(isTemplate || isOwnForm) && (
                          <div className="form-menu">
                            <button
                              className="form-menu-trigger dashboard-table-action-button dashboard-table-text-action-button"
                              onClick={(event) => {
                                const nextOpen = openedMenuFormId !== form.id;
                                setOpenedMenuFormId((prev) => (prev === form.id ? null : form.id));
                                if (nextOpen) {
                                  setOpenedMenuPlacement(getMenuPlacement(event.currentTarget, menuItemCount));
                                }
                              }}
                              disabled={isCurrentFormPending}
                              aria-label={isTemplate ? "Действия с шаблоном" : "Действия с формой"}
                              aria-expanded={openedMenuFormId === form.id}
                            >
                              ...
                            </button>
                            {openedMenuFormId === form.id && (
                              <div
                                className={`form-menu-dropdown ${openedMenuPlacement === "up" ? "form-menu-dropdown-up" : ""}`.trim()}
                                role="menu"
                              >
                                <button
                                  className="form-menu-item"
                                  onClick={() => {
                                    setOpenedMenuFormId(null);
                                    void handleRename(form);
                                  }}
                                  disabled={isCurrentFormPending}
                                >
                                  Переименовать
                                </button>
                                {!isTemplate && (
                                  <button
                                    className="form-menu-item"
                                    onClick={() => {
                                      setOpenedMenuFormId(null);
                                      navigate(routes.builderEdit(form.id));
                                    }}
                                    disabled={isCurrentFormPending}
                                  >
                                    Редактировать
                                  </button>
                                )}
                                {!isTemplate && (
                                  <button
                                    className="form-menu-item"
                                    onClick={() => {
                                      setOpenedMenuFormId(null);
                                      void handleExportResponses(form);
                                    }}
                                    disabled={isCurrentFormPending}
                                  >
                                    Выгрузить в XLSX
                                  </button>
                                )}
                                {!isTemplate && (
                                  <button
                                    className="form-menu-item"
                                    onClick={() => {
                                      setOpenedMenuFormId(null);
                                      void handleDuplicate(form);
                                    }}
                                    disabled={isCurrentFormPending}
                                  >
                                    Дублировать
                                  </button>
                                )}
                                <button
                                  className="form-menu-item form-menu-item-danger"
                                  onClick={() => {
                                    setOpenedMenuFormId(null);
                                    setFormToDelete(form);
                                  }}
                                  disabled={isCurrentFormPending}
                                >
                                  Удалить
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {deadlineEditor && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Дедлайн формы</h3>
            <p className="deadline-modal-subtitle">{deadlineEditor.form.title}</p>
            <label className="deadline-field">
              <span>Дата и время окончания</span>
              <input type="datetime-local" value={deadlineEditor.value} onChange={(e) => setDeadlineEditor((prev) => (prev ? { ...prev, value: e.target.value } : prev))} />
            </label>
            <p className="deadline-modal-hint">После наступления дедлайна форма останется видимой, но новые ответы отправить не получится.</p>
            <div className="deadline-modal-actions">
              <button onClick={() => setDeadlineEditor(null)} disabled={isFormActionPending(deadlineEditor.form.id)}>Отмена</button>
              <button className="deadline-clear-button" onClick={() => deadlineEditor && runAction(() => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: null }), { actionKey: getFormActionKey(deadlineEditor.form.id), successMessage: "Дедлайн снят", errorMessage: "Не удалось обновить дедлайн", affectedFormId: deadlineEditor.form.id, logLabel: `dashboard deadline clear ${deadlineEditor.form.id}` }).finally(() => setDeadlineEditor(null))} disabled={isFormActionPending(deadlineEditor.form.id)}>Снять дедлайн</button>
              <button
                onClick={() => {
                  if (!deadlineEditor) {
                    return;
                  }
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
                  void runAction(() => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: parsedDate.toISOString() }), {
                    actionKey: getFormActionKey(deadlineEditor.form.id),
                    successMessage: "Дедлайн установлен",
                    errorMessage: "Не удалось обновить дедлайн",
                    affectedFormId: deadlineEditor.form.id,
                    logLabel: `dashboard deadline save ${deadlineEditor.form.id}`,
                  }).finally(() => setDeadlineEditor(null));
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
          <div className="modal-card card">
            <h3 style={{ marginTop: 0 }}>Удаление формы</h3>
            <p>Удалить форму «{formToDelete.title}»? Это действие нельзя отменить.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setFormToDelete(null)} disabled={isFormActionPending(formToDelete.id)}>Отмена</button>
              <button onClick={() => void confirmDelete()} disabled={isFormActionPending(formToDelete.id)}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
