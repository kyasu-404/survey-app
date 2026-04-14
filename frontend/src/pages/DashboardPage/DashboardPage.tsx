import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { supabaseClient } from "../../shared/api";
import refreshIcon from "../../img/refresh.png";
import infoIcon from "../../img/info.svg";
import copyLinkIcon from "../../img/copy_link.svg";
import qrIcon from "../../img/qr.svg";
import renameIcon from "../../img/rename.svg";
import editIcon from "../../img/edit.svg";
import copyIcon from "../../img/copy.svg";
import deleteIcon from "../../img/delete.svg";
import deadlineIcon from "../../img/deadline.svg";
import searchIcon from "../../img/search.svg";
import {
  getDashboardFormsPage,
  getDashboardFormsStats,
  getFormById,
  changeFormStatus,
  cloneForm,
  removeForm,
  renameForm,
  setFormDeadline,
  setFormResponseLimit,
} from "../../entities/survey/api/surveysApi";
import {
  applyDeadlineStatePatch,
  getDeadlineStatePatch,
  getNextDeadlineRefreshDelayMs,
} from "../../entities/survey/model/deadlineState";
import {
  getDashboardFormStatsQueryKey,
  getDashboardFormsQueryKey,
} from "../../entities/survey/model/queryKeys";
import { getSurveyDisplayTitle, isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm, SurveyFormSummary } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
import { createQrPngDataUrl, createQrSvg, downloadDataUrl, svgToDataUrl } from "../../shared/lib/qrCode";
import { createPendingStateLogger } from "../../shared/lib/reactQueryDebug";
import { scheduleDebouncedQueryInvalidation, scheduleQueryInvalidation } from "../../shared/lib/queryRefresh";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";

type DashboardPageProps = {
  viewMode: "mine" | "all";
};

type DeadlineEditorState = {
  form: SurveyFormSummary;
  value: string;
};

type ResponseLimitEditorState = {
  form: SurveyFormSummary;
  value: string;
};

type QrDialogState = {
  fileName: string;
  link: string;
  previewDataUrl: string;
  title: string;
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

function getResponsesCounterLabel(count: number, maxResponses?: number | null) {
  if (typeof maxResponses === "number" && maxResponses > 0 && count < maxResponses) {
    return `${count}/${maxResponses} ответов`;
  }

  return getResponsesLabel(count);
}

function isResponseLimitReached(count: number, maxResponses?: number | null) {
  return typeof maxResponses === "number" && maxResponses > 0 && count >= maxResponses;
}

function getAuthorLabel(form: SurveyFormSummary) {
  return form.author_name || form.author_email || form.author_id;
}

export default function DashboardPage({ viewMode }: DashboardPageProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [visibleCount, setVisibleCount] = useState(20);
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});
  const [formToDelete, setFormToDelete] = useState<SurveyFormSummary | null>(null);
  const [openedMenu, setOpenedMenu] = useState<OpenMenuState>(null);
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(null);
  const [responseLimitEditor, setResponseLimitEditor] = useState<ResponseLimitEditorState | null>(null);
  const [qrDialog, setQrDialog] = useState<QrDialogState | null>(null);
  const [qrGeneratingFormId, setQrGeneratingFormId] = useState<string | null>(null);
  const [qrDownloadFormat, setQrDownloadFormat] = useState<"png" | "svg" | null>(null);
  const [deadlineReferenceTime, setDeadlineReferenceTime] = useState(() => new Date());
  const pendingLoadMoreScrollPositionRef = useRef<{ left: number; top: number } | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const listFilters = useMemo(
    () => ({
      search: search.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      authorId: viewMode === "mine" ? user?.id : undefined,
    }),
    [dateFrom, dateTo, search, user?.id, viewMode],
  );

  const formsQueryKey = useMemo(
    () =>
      getDashboardFormsQueryKey({
        dateFrom,
        dateTo,
        search,
        pageSize: visibleCount,
        viewMode,
        userId: user?.id ?? null,
      }),
    [dateFrom, dateTo, search, user?.id, viewMode, visibleCount],
  );

  const formsStatsQueryKey = useMemo(
    () =>
      getDashboardFormStatsQueryKey({
        dateFrom,
        dateTo,
        search,
        viewMode,
        userId: user?.id ?? null,
      }),
    [dateFrom, dateTo, search, user?.id, viewMode],
  );

  const {
    data: formsPage,
    isLoading: isFormsLoading,
    isFetching: isFormsFetching,
    error: formsError,
    refetch: reloadForms,
    dataUpdatedAt: formsUpdatedAt,
  } = useQuery({
    queryKey: formsQueryKey,
    queryFn: () =>
      getDashboardFormsPage({
        page: 0,
        pageSize: visibleCount,
        filters: listFilters,
      }),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(user?.id)),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const { data: formsStats } = useQuery({
    queryKey: formsStatsQueryKey,
    queryFn: () => getDashboardFormsStats(listFilters),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(user?.id)),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
  });

  const loadedForms = formsPage?.items ?? [];

  const visibleForms = useMemo(() => {
    return loadedForms.map((form) => {
      const deadlineStatePatch = getDeadlineStatePatch(form, deadlineReferenceTime);
      return deadlineStatePatch ? applyDeadlineStatePatch(form, deadlineStatePatch) : form;
    });
  }, [deadlineReferenceTime, loadedForms]);

  const filteredForms = useMemo(() => {
    return visibleForms.filter((form) => !isTemplateForm(form));
  }, [visibleForms]);

  const displayedForms = filteredForms;
  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const nextDeadlineRefreshDelayMs = useMemo(
    () => getNextDeadlineRefreshDelayMs(filteredForms, deadlineReferenceTime),
    [deadlineReferenceTime, filteredForms],
  );
  const isInitialFormsLoading = isFormsLoading && loadedForms.length === 0;
  const fallbackActiveFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && form.is_public).length;
  const fallbackDeadlineFormsCount = filteredForms.filter((form) => !isTemplateForm(form) && Boolean(form.deadline_at)).length;
  const totalFormsCount = Math.max(formsStats?.totalCount ?? 0, formsPage?.totalCount ?? filteredForms.length);
  const activeFormsCount = Math.max(formsStats?.activeCount ?? 0, fallbackActiveFormsCount);
  const formsWithDeadlineCount = Math.max(formsStats?.formsWithDeadlineCount ?? 0, fallbackDeadlineFormsCount);
  const hasMoreForms = filteredForms.length < totalFormsCount;

  useLayoutEffect(() => {
    const scrollPosition = pendingLoadMoreScrollPositionRef.current;
    if (!scrollPosition || typeof window === "undefined") {
      return;
    }

    pendingLoadMoreScrollPositionRef.current = null;
    window.scrollTo({ ...scrollPosition, behavior: "auto" });
  }, [visibleCount]);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [dateFrom, dateTo, pageSize, search, viewMode]);

  useEffect(() => {
    if (formsError) {
      showToast(getErrorMessage(formsError, "Не удалось загрузить формы"), "error");
    }
  }, [formsError, showToast]);

  useEffect(() => {
    setDeadlineReferenceTime(new Date());
  }, [formsUpdatedAt]);

  useEffect(() => {
    if (nextDeadlineRefreshDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDeadlineReferenceTime(new Date());
    }, Math.min(nextDeadlineRefreshDelayMs + 250, MAX_TIMEOUT_MS));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [nextDeadlineRefreshDelayMs]);

  useEffect(() => {
    if (isAuthLoading || (viewMode === "mine" && !user?.id)) {
      return;
    }

    const formFilter = viewMode === "mine" && user?.id ? `author_id=eq.${user.id}` : undefined;
    const channel = supabaseClient
      .channel(`dashboard-forms:${viewMode}:${user?.id ?? "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "forms",
          ...(formFilter ? { filter: formFilter } : {}),
        },
        () => {
          scheduleDebouncedQueryInvalidation(
            queryClient,
            `dashboard realtime ${viewMode} forms`,
            [{ queryKey: formsQueryKey }, { queryKey: formsStatsQueryKey }],
            750,
          );
        },
      )
      .subscribe((status) => {
        console.info("[realtime] dashboard forms channel status", {
          status,
          userId: user?.id ?? null,
          viewMode,
        });
      });

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [formsQueryKey, formsStatsQueryKey, isAuthLoading, queryClient, user?.id, viewMode]);

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
  const getFormLink = (formId: string) => `${appOrigin}${routes.survey(formId)}`;

  const scheduleFormsRefresh = () => {
    scheduleQueryInvalidation(queryClient, "dashboard forms refresh", [
      { queryKey: formsQueryKey },
      { queryKey: formsStatsQueryKey },
    ]);
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
  const responseLimitMutation = useMutation({
    mutationFn: ({ id, maxResponses }: { id: string; maxResponses: number | null }) =>
      setFormResponseLimit(id, maxResponses),
  });

  const runAction = async (action: () => Promise<unknown>, options: DashboardActionOptions) => {
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
      const copied = await copyTextToClipboard(getFormLink(formId));
      if (!copied) {
        showToast("Автокопирование недоступно. Скопируйте ссылку вручную.", "warning");
        return;
      }
      showToast("Ссылка скопирована", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скопировать ссылку"), "error");
    }
  };

  const handleOpenQrCode = async (form: SurveyFormSummary) => {
    const link = getFormLink(form.id);
    const title = getSurveyDisplayTitle(form);

    setQrGeneratingFormId(form.id);

    try {
      const svg = await createQrSvg(link);
      setQrDialog({
        fileName: `form-${form.id}-qr`,
        link,
        previewDataUrl: svgToDataUrl(svg),
        title,
      });
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось сгенерировать QR-код"), "error");
    } finally {
      setQrGeneratingFormId(null);
    }
  };

  const handleDownloadQr = async (format: "png" | "svg") => {
    if (!qrDialog) {
      return;
    }

    setQrDownloadFormat(format);

    try {
      if (format === "png") {
        const pngDataUrl = await createQrPngDataUrl(qrDialog.link);
        downloadDataUrl(pngDataUrl, `${qrDialog.fileName}.png`);
      } else {
        const svg = await createQrSvg(qrDialog.link);
        downloadDataUrl(svgToDataUrl(svg), `${qrDialog.fileName}.svg`);
      }
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скачать QR-код"), "error");
    } finally {
      setQrDownloadFormat(null);
    }
  };

  const handleRename = async (form: SurveyFormSummary) => {
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

  const handleDuplicate = async (form: SurveyFormSummary) => {
    if (!user?.id) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(async () => {
      const fullForm = await queryClient.fetchQuery({
        queryKey: ["form", form.id],
        queryFn: () => getFormById(form.id),
        staleTime: 60_000,
      });

      await duplicateMutation.mutateAsync({ form: fullForm, authorId: user.id });
    }, {
      actionKey: getFormActionKey(form.id),
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось дублировать форму",
      logLabel: `dashboard duplicate ${form.id}`,
    });
  };

  const handleToggleFormStatus = async (form: SurveyFormSummary) => {
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

  const handleCardOpen = (form: SurveyFormSummary) => {
    if (isTemplateForm(form)) {
      return;
    }

    navigate(routes.survey(form.id), { state: { isPreview: true } });
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, form: SurveyFormSummary) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleCardOpen(form);
  };

  const stopCardEvent = (event: ReactMouseEvent | ReactKeyboardEvent) => {
    event.stopPropagation();
  };

  const handleLoadMoreForms = () => {
    if (typeof window !== "undefined") {
      pendingLoadMoreScrollPositionRef.current = {
        left: window.scrollX,
        top: window.scrollY,
      };
    }

    setVisibleCount((current) => current + pageSize);
  };

  return (
    <div className="dashboard-page dashboard-shell">
      <div className="card dashboard-main-card">
        <div className="dashboard-toolbar">
          <div className="dashboard-search-group">
            <div className="dashboard-search-input-shell">
              <img src={searchIcon} alt="" aria-hidden="true" className="dashboard-search-icon" />
              <input
                className="dashboard-search-input"
                placeholder="Поиск по названию и автору"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
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
                    <strong>{totalFormsCount}</strong>
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
          {displayedForms.map((form, formIndex) => {
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
            const hasReachedResponseLimit = isResponseLimitReached(responsesCount, form.max_responses);

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
                    navigate(routes.formResponses(form.id));
                  }}
                >
                  {getResponsesCounterLabel(responsesCount, form.max_responses)}
                </button>
              ) : null,
            ].filter(Boolean);

            const isFirstVisibleForm = formIndex === 0;

            const actionMenu = (
              <div
                className={`form-menu dashboard-floating-root dashboard-actions-menu-shell ${
                  isFirstVisibleForm ? "dashboard-actions-menu-shell-open-down" : ""
                }`.trim()}
              >
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
                    onClick={stopCardEvent}
                  >
                    {!isTemplate && (
                      <>
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
                          <img src={copyLinkIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                          <span className="form-menu-item-label">Копировать ссылку</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="form-menu-item"
                          onClick={(event) => {
                            stopCardEvent(event);
                            setOpenedMenu(null);
                            void handleOpenQrCode(form);
                          }}
                          disabled={isCurrentFormPending || qrGeneratingFormId === form.id}
                        >
                          <img src={qrIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                          <span className="form-menu-item-label">Генерировать QR</span>
                        </button>
                      </>
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
                        <img src={renameIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                        <span className="form-menu-item-label">Переименовать</span>
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
                        <img src={editIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                        <span className="form-menu-item-label">Редактировать</span>
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
                        <img src={copyIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                        <span className="form-menu-item-label">Дублировать</span>
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
                        <img src={deleteIcon} alt="" aria-hidden="true" className="form-menu-item-icon" />
                        <span className="form-menu-item-label">Удалить</span>
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
                <div className={`dashboard-form-header ${statusMenuOpen ? "dashboard-form-header-status-menu-open" : ""}`.trim()}>
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
                              onClick={stopCardEvent}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                className={`form-menu-item ${
                                  isFormActive ? "form-menu-item-danger" : "dashboard-status-menu-item-open"
                                }`.trim()}
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
                              <button
                                type="button"
                                role="menuitem"
                                className="form-menu-item"
                                onClick={(event) => {
                                  stopCardEvent(event);
                                  setOpenedMenu(null);
                                  setResponseLimitEditor({
                                    form,
                                    value: form.max_responses ? String(form.max_responses) : "",
                                  });
                                }}
                                disabled={isCurrentFormPending}
                              >
                                Ограничить ответы
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
            <button type="button" className="dashboard-load-more-button" onClick={handleLoadMoreForms}>
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
                disabled={isFormActionPending(deadlineEditor.form.id) || !deadlineEditor.form.deadline_at}
              >
                {isFormActionPending(deadlineEditor.form.id) && <InlineSpinner />}
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
                {isFormActionPending(deadlineEditor.form.id) && <InlineSpinner />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {responseLimitEditor && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal" role="dialog" aria-modal="true" aria-label="Ограничение ответов">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Ограничение ответов</h3>
            <p className="deadline-modal-subtitle">{responseLimitEditor.form.title}</p>
            <label className="deadline-field">
              <span>Максимум ответов</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={responseLimitEditor.value}
                onChange={(event) =>
                  setResponseLimitEditor((current) =>
                    current ? { ...current, value: event.target.value } : current,
                  )
                }
              />
            </label>
            <p className="deadline-modal-hint">
              Когда лимит будет достигнут, новые ответы не будут приниматься.
            </p>
            <div className="deadline-modal-actions">
              <button
                type="button"
                onClick={() => setResponseLimitEditor(null)}
                disabled={isFormActionPending(responseLimitEditor.form.id)}
              >
                Отмена
              </button>
              {responseLimitEditor.form.max_responses ? (
                <button
                  type="button"
                  className="deadline-clear-button"
                  onClick={() =>
                    runAction(
                      () => responseLimitMutation.mutateAsync({ id: responseLimitEditor.form.id, maxResponses: null }),
                      {
                        actionKey: getFormActionKey(responseLimitEditor.form.id),
                        successMessage: "Ограничение снято",
                        errorMessage: "Не удалось обновить ограничение",
                        affectedFormId: responseLimitEditor.form.id,
                        logLabel: `dashboard response limit clear ${responseLimitEditor.form.id}`,
                      },
                    ).finally(() => setResponseLimitEditor(null))
                  }
                  disabled={isFormActionPending(responseLimitEditor.form.id)}
                >
                  {isFormActionPending(responseLimitEditor.form.id) && <InlineSpinner />}
                  Снять ограничение
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const normalizedInput = responseLimitEditor.value.trim();
                  const parsedLimit = Number(normalizedInput);

                  if (!normalizedInput || !Number.isInteger(parsedLimit) || parsedLimit <= 0) {
                    showToast("Укажите положительное целое число ответов", "error");
                    return;
                  }

                  void runAction(
                    () => responseLimitMutation.mutateAsync({ id: responseLimitEditor.form.id, maxResponses: parsedLimit }),
                    {
                      actionKey: getFormActionKey(responseLimitEditor.form.id),
                      successMessage: "Ограничение сохранено",
                      errorMessage: "Не удалось обновить ограничение",
                      affectedFormId: responseLimitEditor.form.id,
                      logLabel: `dashboard response limit save ${responseLimitEditor.form.id}`,
                    },
                  ).finally(() => setResponseLimitEditor(null));
                }}
                disabled={isFormActionPending(responseLimitEditor.form.id)}
              >
                {isFormActionPending(responseLimitEditor.form.id) && <InlineSpinner />}
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
                {isFormActionPending(formToDelete.id) && <InlineSpinner />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {qrDialog && (
        <div className="modal-backdrop">
          <div className="modal-card card dashboard-qr-modal" role="dialog" aria-modal="true" aria-label={`QR-код формы ${qrDialog.title}`}>
            <div className="dashboard-qr-modal-header">
              <div>
                <h3 className="dashboard-qr-modal-title">QR-код формы</h3>
                <p className="dashboard-qr-modal-copy">{qrDialog.title}</p>
              </div>
              <button type="button" className="dashboard-qr-close-button" aria-label="Закрыть QR-код" onClick={() => setQrDialog(null)}>
                x
              </button>
            </div>
            <div className="dashboard-qr-download-actions">
              <button type="button" onClick={() => void handleDownloadQr("png")} disabled={qrDownloadFormat !== null}>
                PNG
              </button>
              <button type="button" onClick={() => void handleDownloadQr("svg")} disabled={qrDownloadFormat !== null}>
                SVG
              </button>
            </div>
            <div className="dashboard-qr-preview">
              <img src={qrDialog.previewDataUrl} alt={`QR-код формы ${qrDialog.title}`} />
            </div>
            <p className="dashboard-qr-link">{qrDialog.link}</p>
          </div>
        </div>
      )}
    </div>
  );
}
