import { Presence } from "../../shared/ui/Presence";
import {officeRequest} from '../../entities/office/api';
import onlyofficeIcon from '../../img/onlyoffice-mono.svg';
import { DocumentsModal } from "./DocumentsModal";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useToast } from "../../app/providers/ToastProvider";
import { useAuth } from "../../app/providers/AuthProvider";
import { getOrganizations } from "../../entities/organization/api";
import {
  getOrganizationDisplayName,
  hasOrganizationQuestion,
  normalizeOrganizationTypes,
} from "../../entities/organization/model";
import { deleteResponses, getAllResponsesByForm, getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { getDeadlineStatePatch } from "../../entities/survey/model/deadlineState";
import { getFormReasonLabel, getFormTypeLabel } from "../../entities/survey/model/formOptions";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import { isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";
import { Icon } from "../../shared/ui/Icon";
import pinBlackIcon from "../../img/Pin_black.svg";
import pinWhiteIcon from "../../img/Pin_white.svg";
import { supabaseClient } from "../../shared/api";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";
import { hasArchiveFileQuestions } from "../../entities/response/lib/responseFiles";
import { createQueryRefreshScheduler } from "../../shared/lib/queryRefresh";
import type { ResponsesTableRow, ResponsesTableColumn } from "../../entities/response/lib/responsesExport";
import { getSignatureImage, SIGNATURE_UNAVAILABLE } from "../../shared/lib/signatureImage";
import { formatResponsesForTable, getResponseColumnClassName, RESPONSE_DATE_KEY } from "../../entities/response/lib/responsesExport";
import { createResponseReport, type ResponseReport } from "../../entities/response/lib/responseReport";
import { Skeleton } from "../../shared/ui/Skeleton";
import { ResponsePreviewSheet } from "./ResponsePreviewSheet";
import { ResponseReportModal } from "./ResponseReportModal";
import { useNewResponseHighlights } from "./useNewResponseHighlights";
import { createRealtimeRecovery } from "../../shared/lib/realtimeRecovery";

const ShareFormModal = lazy(() => import("../DashboardPage/components/ShareFormModal").then(module => ({ default: module.ShareFormModal })));

type SelectedResponsePreview = {
  label: string;
  response: SurveyResponse;
};

function getRealtimeRevision(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  // PostgreSQL bigint revisions may arrive as decimal strings. An unsafe
  // JavaScript number cannot establish that two revisions are equal.
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function getResponsePreviewLabel(row: ResponsesTableRow, index: number, columns: ResponsesTableColumn[]) {
  const primaryValue = Object.entries(row).find(
    ([key, value]) => key !== RESPONSE_DATE_KEY && value.trim().length > 0
      && columns.find(column => column.key === key)?.answerType !== "signaturepad",
  )?.[1];

  return primaryValue ? `Ответ ${primaryValue}` : `Ответ ${index + 1}`;
}

function hasAnswerValue(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function pageHasAnswer(element: unknown, answeredNames: Set<string>): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: element, depth: 0 }];
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !current.value || typeof current.value !== "object") {
      continue;
    }

    visitedNodes += 1;
    if (current.depth > 32 || visitedNodes > 10_000) {
      return false;
    }

    const record = current.value as Record<string, unknown>;
    if (typeof record.name === "string" && answeredNames.has(record.name)) {
      return true;
    }

    ["elements", "items", "rows", "columns", "panels", "templateElements"].forEach((key) => {
      const nested = record[key];
      if (Array.isArray(nested)) {
        nested.forEach((item) => pending.push({ value: item, depth: current.depth + 1 }));
      }
    });
  }

  return false;
}

function getFirstAnsweredPageNo(schema: SurveySchema, data: Record<string, unknown>) {
  const answeredNames = new Set(
    Object.entries(data)
      .filter(([, value]) => hasAnswerValue(value))
      .map(([name]) => name),
  );

  if (answeredNames.size === 0) {
    return undefined;
  }

  const pages = Array.isArray(schema.pages) ? schema.pages : [];
  const pageIndex = pages.findIndex((page) => {
    const elements = Array.isArray(page?.elements) ? page.elements : [];
    return elements.some((element) => pageHasAnswer(element, answeredNames));
  });

  return pageIndex > 0 ? pageIndex : undefined;
}

function getDateCellParts(value: string) {
  const [datePart, timePart] = value.split(",").map((part) => part.trim());

  if (!timePart) {
    return { datePart: value, timePart: "" };
  }

  return { datePart, timePart: timePart.split(":").slice(0, 2).join(":") };
}

function SelectAllResponsesCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={checkboxRef}
      type="checkbox"
      aria-label="Выбрать ответы на странице"
      checked={checked}
      onChange={onChange}
    />
  );
}

function renderResponseCell(column: ResponsesTableColumn, value: string) {
  if (column.answerType === "signaturepad" && value) {
    const image = getSignatureImage(value);
    return image ? <img className="response-signature-image" src={image.dataUrl} alt="Подпись" /> : SIGNATURE_UNAVAILABLE;
  }
  if (!column.isDate) {
    return value;
  }

  const { datePart, timePart } = getDateCellParts(value);

  return (
    <span className="responses-table-date-cell">
      <span className="responses-table-date-line">{datePart}</span>
      {timePart && <span className="responses-table-date-line">{timePart}</span>}
    </span>
  );
}

export default function FormResponsesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fromFormsList = location.state?.fromFormsList;
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [selectedResponsePreview, setSelectedResponsePreview] = useState<SelectedResponsePreview | null>(null);
  const [selectedResponseIds, setSelectedResponseIds] = useState<Set<string>>(() => new Set());
  const [isDeletingResponses, setIsDeletingResponses] = useState(false);
  const [responseReport, setResponseReport] = useState<ResponseReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [shareDialog, setShareDialog] = useState<{ formId: string; tab: "link" | "mail" } | null>(null);
  const officeStatus = useQuery({
    queryKey: ["office-status"],
    queryFn: () => officeRequest<{ enabled: boolean }>("/status"),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: documentsOpen ? 30_000 : false,
    retry: false,
  });
  const [isHeaderPinned, setIsHeaderPinned] = useState(false);
  const [isPreparingZip, setIsPreparingZip] = useState(false);
  const zipControllerRef = useRef<AbortController | null>(null);
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const pageSize = 50;
  const responsesQueryKey = getFormResponsesQueryKey(id, "page", page, pageSize);
  const [searchParams] = useSearchParams();
  const linkedResponseId = searchParams.get("response");
  const linkedResponseQuery = useQuery({
    queryKey: getFormResponsesQueryKey(id, "linked", linkedResponseId),
    queryFn: async ({ signal }) => (await getAllResponsesByForm(id!, { responseIds: [linkedResponseId!], signal }))[0] ?? null,
    enabled: Boolean(id && linkedResponseId),
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  const linkedPreview = linkedResponseQuery.isSuccess && linkedResponseQuery.isFetchedAfterMount && linkedResponseQuery.data
    ? { label: "Ответ на форму", response: linkedResponseQuery.data } : null;
  const preview = linkedResponseId ? linkedPreview : selectedResponsePreview;

  function clearResponseLink() {
    if (linkedResponseId) {
      const next = new URLSearchParams(searchParams);
      next.delete("response");
      navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true, state: location.state });
    }
  }


  useEffect(() => {
    setPage(1);
    setSelectedResponsePreview(null);
    setSelectedResponseIds(new Set());
    setResponseReport(null);
    setShareDialog(null);
    setIsHeaderPinned(false);
    setIsPreparingZip(false);
    return () => {
      zipControllerRef.current?.abort();
      zipControllerRef.current = null;
    };
  }, [id]);

  const formQuery = useQuery({
    queryKey: getFormQueryKey(id),
    queryFn: async ({ signal }) => {
      if (!id) {
        return null;
      }

      return getFormById(id, { signal });
    },
    enabled: Boolean(id),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const responsesQuery = useQuery({
    queryKey: responsesQueryKey,
    queryFn: async ({ signal }) => {
      if (!id) {
        return { data: [], count: 0, page, pageSize, totalPages: 1 };
      }

      return getResponsesByForm(id, { signal, page, pageSize });
    },
    enabled: Boolean(id),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const usesOrganizationDirectory = Boolean(
    formQuery.data && hasOrganizationQuestion(formQuery.data.schema),
  );
  const hasFileQuestions = useMemo(
    () => Boolean(formQuery.data && hasArchiveFileQuestions(formQuery.data.schema)),
    [formQuery.data],
  );
  const formOrganizationTypes = normalizeOrganizationTypes(formQuery.data?.organization_types);
  const organizationsQuery = useQuery({
    queryKey: ["education-organizations", "history", id],
    queryFn: ({ signal }) => getOrganizations(undefined, signal, true),
    enabled: Boolean(id && usesOrganizationDirectory),
    staleTime: 30_000,
  });

  const responses = responsesQuery.data?.data ?? [];
  const highlightedResponses = useNewResponseHighlights(id, page, responsesQuery.data?.data, responsesQuery.data?.count ?? 0);
  const directoryLabels = useMemo(
    () => new Map(
      (organizationsQuery.data ?? []).map((organization) => [
        organization.id,
        getOrganizationDisplayName(organization),
      ]),
    ),
    [organizationsQuery.data],
  );
  const organizationLabels = usesOrganizationDirectory ? directoryLabels : undefined;
  const { rows, columns } = useMemo(
    () => (formQuery.data
      ? formatResponsesForTable(responses, formQuery.data.schema, organizationLabels)
      : { rows: [], columns: [] }),
    [formQuery.data, organizationLabels, responses],
  );

  const isLoading =
    (!formQuery.data || !responsesQuery.data) && (formQuery.isLoading || responsesQuery.isLoading);
  const isRefreshing = formQuery.isFetching || responsesQuery.isFetching || (usesOrganizationDirectory && organizationsQuery.isFetching);
  const combinedError = [formQuery.error, responsesQuery.error, usesOrganizationDirectory ? organizationsQuery.error : null]
    .find((error) => error && !isAbortError(error)) ?? null;
  const totalResponses = responsesQuery.data?.count ?? 0;
  const totalPages = responsesQuery.data?.totalPages ?? 1;
  const form = formQuery.data;
  const canShareForm = Boolean(form?.is_public && !isTemplateForm(form) && !getDeadlineStatePatch(form));
  const canInviteOrganizations = canShareForm && Boolean(
    user && form?.author_id === user.id && form.personal_links_enabled && usesOrganizationDirectory,
  );
  const canDeleteResponses = Boolean(
    formQuery.data && (formQuery.data.author_id === user?.id || profile?.role === "admin"),
  );
  const selectedVisibleResponses = responses.filter((response) => selectedResponseIds.has(response.id)).length;
  const allVisibleResponsesSelected = responses.length > 0 && selectedVisibleResponses === responses.length;

  useEffect(() => {
    const visibleResponseIds = new Set(responses.map((response) => response.id));
    setSelectedResponseIds((current) => {
      const next = new Set([...current].filter((responseId) => visibleResponseIds.has(responseId)));
      return next.size === current.size ? current : next;
    });
  }, [responses]);

  useEffect(() => {
    if (!id) {
      return;
    }

    const refresh = createQueryRefreshScheduler(queryClient, `form responses realtime ${id}`, 100);
    const refreshResponses = () => refresh.schedule([{ queryKey: getFormResponsesQueryKey(id) }]);
    const refreshForm = () => refresh.schedule([
      { queryKey: getFormQueryKey(id) },
      { queryKey: getFormResponsesQueryKey(id) },
    ]);
    const handleFormUpdate = (payload: unknown) => {
      const event = payload && typeof payload === "object"
        ? payload as { new?: Record<string, unknown>; commit_timestamp?: unknown }
        : null;
      const state = queryClient.getQueryState<SurveyForm | null>(getFormQueryKey(id));
      const cachedForm = state?.data;
      const cachedRevision = getRealtimeRevision(cachedForm?.revision);
      const nextRevision = getRealtimeRevision(event?.new?.revision);
      const count = event?.new?.responses_count;
      const committedAt = typeof event?.commit_timestamp === "string"
        ? Date.parse(event.commit_timestamp)
        : NaN;

      if (!cachedForm || state?.fetchStatus !== "idle" || event?.new?.id !== id
        || cachedRevision === null || nextRevision === null || cachedRevision !== nextRevision
        || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
        || !Number.isFinite(committedAt)) {
        refreshForm();
        return;
      }

      // HTTP completion uses the client clock, not the database snapshot time.
      // A differing count behind that timestamp needs an authoritative reread.
      if (committedAt < state.dataUpdatedAt && count !== cachedForm.responses_count) {
        refreshForm();
        return;
      }
      if (committedAt >= state.dataUpdatedAt) {
        queryClient.setQueryData<SurveyForm>(getFormQueryKey(id), {
          ...cachedForm,
          responses_count: count,
        }, { updatedAt: committedAt });
      }
      refreshResponses();
    };
    const recovery = createRealtimeRecovery(refreshForm, showToast);

    const channel = supabaseClient
      .channel(`form-responses:${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responses",
          filter: `form_id=eq.${id}`,
        },
        refreshResponses,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "forms",
          filter: `id=eq.${id}`,
        },
        handleFormUpdate,
      )
      .subscribe((status) => {
        recovery.status(status);
        console.info("[realtime] form responses channel status", {
          formId: id,
          status,
        });
      });

    return () => {
      recovery.dispose();
      refresh.dispose();
      void supabaseClient.removeChannel(channel);
    };
  }, [id, queryClient, showToast]);

  const loadExportResponses = (signal?: AbortSignal) => getAllResponsesByForm(id!, {
    signal,
    responseIds: selectedResponseIds.size ? [...selectedResponseIds] : undefined,
  });

  useEffect(() => {
    if (!responsesQuery.data) return;
    const resolvedPage = "page" in responsesQuery.data ? responsesQuery.data.page : page;
    if (typeof resolvedPage === "number" && resolvedPage !== page) {
      queryClient.setQueryData(getFormResponsesQueryKey(id, "page", resolvedPage, pageSize), responsesQuery.data);
      setPage(resolvedPage);
    }
    else if (page > totalPages) setPage(totalPages);
  }, [responsesQuery.data, page, totalPages, queryClient, id, pageSize]);

  const handleExport = async () => {
    if (!id || !formQuery.data || isExporting) return;
    setIsExporting(true);
    try {
      const exportResponses = await loadExportResponses();
      if (!exportResponses.length) { showToast("Нет данных для выгрузки", "warning"); return; }
      const table = formatResponsesForTable(exportResponses, formQuery.data.schema, organizationLabels);
      await exportToExcel(table.rows, `ответы-${formQuery.data.title}`, "Ответы", table.columns);
      showToast("Ответы выгружены в XLSX", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось выгрузить ответы"), "error");
    } finally { setIsExporting(false); }
  };

  const handleExportFiles = async () => {
    if (!id || !formQuery.data || !responsesQuery.data || zipControllerRef.current) return;
    const responsePage = responsesQuery.data;
    const pageOffset = ((responsePage.page ?? page) - 1) * (responsePage.pageSize ?? pageSize);
    const selected = selectedResponseIds.size ? responses.flatMap((response, index) =>
      selectedResponseIds.has(response.id) ? [{ id: response.id, number: pageOffset + index + 1 }] : [],
    ) : undefined;
    if (selected && selected.length !== selectedResponseIds.size) {
      showToast("Список ответов обновился. Выберите ответы для выгрузки ещё раз.", "warning");
      return;
    }
    const controller = new AbortController();
    zipControllerRef.current = controller;
    setIsPreparingZip(true);
    try {
      const { exportResponseFilesZip } = await import("../../entities/response/lib/responseFilesZip");
      const started = await exportResponseFilesZip(id, selected, controller.signal);
      if (controller.signal.aborted) return;
      if (started) showToast("Скачивание ZIP началось", "success");
      else showToast("В ответах пока нет прикреплённых файлов", "warning");
    } catch (error) {
      if (!controller.signal.aborted) showToast(getErrorMessage(error, "Не удалось выгрузить файлы"), "error");
    } finally {
      if (zipControllerRef.current === controller) {
        zipControllerRef.current = null;
        setIsPreparingZip(false);
      }
    }
  };

  const handleOpenReport = async () => {
    if (!id || !formQuery.data || !responsesQuery.data) {
      return;
    }

    setIsGeneratingReport(true);
    try {
      const reportResponses = await getAllResponsesByForm(id);
      const reportOrganizations = usesOrganizationDirectory
        ? (organizationsQuery.data ?? await getOrganizations(undefined, undefined, true))
          .filter((organization) => !organization.is_archived && formOrganizationTypes.includes(organization.organization_type))
        : [];
      setResponseReport(createResponseReport(reportResponses, formQuery.data.schema, reportOrganizations));
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось сформировать отчёт"), "error");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleOpenHtml = () => {
    if (!id) {
      return;
    }

    navigate(routes.formResponsesHtml(id));
  };

  const handleCopyFormLink = async () => {
    if (!form || !canShareForm) return;

    try {
      if (await copyTextToClipboard(`${window.location.origin}${routes.survey(form.id)}`)) {
        showToast("Ссылка скопирована", "success");
        return;
      }
    } catch {
      // The share dialog offers a selectable URL even without clipboard access.
    }

    setShareDialog(current => current ?? { formId: form.id, tab: "link" });
    showToast("Выделите и скопируйте ссылку вручную.", "warning");
  };

  function closeResponsePreview() {
    clearResponseLink();
    setSelectedResponsePreview(null);
  }

  const handleOpenResponsePreview = (response: SurveyResponse, row: ResponsesTableRow, index: number) => {
    clearResponseLink();
    setSelectedResponsePreview({
      label: getResponsePreviewLabel(row, index, columns),
      response,
    });
  };

  const handleResponseRowKeyDown = (
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    response: SurveyResponse,
    row: ResponsesTableRow,
    index: number,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleOpenResponsePreview(response, row, index);
  };

  const toggleResponseSelection = (responseId: string) => {
    setSelectedResponseIds((current) => {
      const next = new Set(current);
      if (next.has(responseId)) {
        next.delete(responseId);
      } else {
        next.add(responseId);
      }
      return next;
    });
  };

  const toggleAllVisibleResponses = () => {
    setSelectedResponseIds(
      allVisibleResponsesSelected ? new Set() : new Set(responses.map((response) => response.id)),
    );
  };

  const handleDeleteSelectedResponses = async () => {
    if (!id || !canDeleteResponses || selectedResponseIds.size === 0) {
      return;
    }

    const selectedCount = selectedResponseIds.size;
    if (!window.confirm(`Удалить выбранные ответы (${selectedCount})? Это действие нельзя отменить.`)) {
      return;
    }

    setIsDeletingResponses(true);
    try {
      await deleteResponses(id, [...selectedResponseIds]);
      setSelectedResponseIds(new Set());
      if (selectedResponsePreview && selectedResponseIds.has(selectedResponsePreview.response.id)) {
        setSelectedResponsePreview(null);
      }
      showToast(`Удалено ответов: ${selectedCount}`, "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось удалить ответы"), "error");
    } finally {
      // A later batch may fail after earlier batches have already been deleted.
      await Promise.all([formQuery.refetch(), responsesQuery.refetch()]);
      setIsDeletingResponses(false);
    }
  };

  if (!id) {
    return <p>Форма не найдена.</p>;
  }

  return (
    <div className="dashboard-page">
      <Presence kind="modal">{documentsOpen && <DocumentsModal formId={id} selectedResponseIds={[...selectedResponseIds]} onClose={() => setDocumentsOpen(false)} />}</Presence>
      <div className="card responses-page-card">
        <Link
          className="responses-back-link"
          to={fromFormsList === "mine" ? routes.dashboardMy : routes.dashboardAll}
          onClick={(event) => {
            if (fromFormsList !== "mine" && fromFormsList !== "all") return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(-1);
          }}
        >
          ← Назад к формам
        </Link>
        <div className="responses-page-header">
          <div className="responses-page-header-copy">
            <h1 className="responses-page-title">{formQuery.data?.title ?? "Ответы формы"}</h1>
            {formQuery.data && (
              <div className="responses-page-meta">
                <p className="responses-page-meta-item">Тип: {getFormTypeLabel(formQuery.data.form_type)}</p>
                <p className="responses-page-meta-item">Основание: {getFormReasonLabel(formQuery.data.form_reason)}</p>
              </div>
            )}
          </div>
          <div className="responses-page-toolbar">
            <button type="button" className="responses-export-button" onClick={handleExport} disabled={isLoading || isExporting}>
              <span>{isExporting ? "Выгрузка…" : selectedResponseIds.size ? "Скачать выбранные XLSX" : "Скачать XLSX"}</span>
              <Icon name="download" className="toolbar-icon" size={18} />
            </button>
            {hasFileQuestions && (
              <button
                type="button"
                className="responses-export-button"
                aria-label="Файлы в ZIP"
                aria-busy={isPreparingZip}
                onClick={() => void handleExportFiles()}
                disabled={isLoading || isPreparingZip}
              >
                <span>{isPreparingZip ? "Подготовка ZIP…" : selectedResponseIds.size ? "Выбранные файлы в ZIP" : "Файлы в ZIP"}</span>
                <Icon name="download" className="toolbar-icon" size={18} />
              </button>
            )}
            <button
              type="button"
              className="responses-export-button responses-html-button"
              onClick={handleOpenHtml}
              disabled={isLoading}
            >
              <span>HTML</span>
              <Icon name="description" className="toolbar-icon" size={18} />
            </button>
            {officeStatus.data?.enabled && <button type="button" className="responses-export-button" onClick={() => setDocumentsOpen(true)} disabled={isLoading}><span>Документы</span><img src={onlyofficeIcon} alt="" aria-hidden="true" className="toolbar-icon"/></button>}
            <button
              type="button"
              className="responses-export-button responses-report-button"
              onClick={() => void handleOpenReport()}
              disabled={isLoading || isGeneratingReport}
            >
              <span>{isGeneratingReport ? "Формирование…" : "Отчёт"}</span>
              <Icon name="info" className="toolbar-icon" size={18} />
            </button>
          </div>
        </div>

        {linkedResponseId && (linkedResponseQuery.isError || (linkedResponseQuery.isFetchedAfterMount && linkedResponseQuery.data === null)) &&
          <p className="activity-error" role="alert">Ответ по ссылке недоступен.</p>}
        {canDeleteResponses && selectedResponseIds.size > 0 && (
          <div className="responses-selection-bar" aria-live="polite">
            <strong className="responses-selection-count">Выбрано: {selectedResponseIds.size}</strong>
            <button
              type="button"
              className="responses-delete-button"
              onClick={() => void handleDeleteSelectedResponses()}
              disabled={isDeletingResponses}
            >
              <span>{isDeletingResponses ? "Удаление…" : "Удалить"}</span>
              <Icon name="delete" className="toolbar-icon" size={18} />
            </button>
          </div>
        )}

        {isLoading && (
          <div className="responses-page-table-shell responses-page-skeleton" aria-hidden="true">
            <div className="responses-page-skeleton-head">
              <Skeleton className="responses-page-skeleton-cell" />
              <Skeleton className="responses-page-skeleton-cell" />
              <Skeleton className="responses-page-skeleton-cell" />
            </div>
            {Array.from({ length: 4 }, (_, index) => (
              <div key={`responses-skeleton-${index}`} className="responses-page-skeleton-row">
                <Skeleton className="responses-page-skeleton-cell" />
                <Skeleton className="responses-page-skeleton-cell" />
                <Skeleton className="responses-page-skeleton-cell" />
              </div>
            ))}
          </div>
        )}
        {!isLoading && combinedError && (
          <p className="responses-page-error">{getErrorMessage(combinedError, "Не удалось загрузить ответы")}</p>
        )}

        {!isLoading && !combinedError && !rows.length && (
          form ? (
            <div className="dashboard-empty-state responses-page-empty">
              <h4>Ответов пока нет</h4>
              {canShareForm && responsesQuery.data?.count === 0 ? (
                <>
                  <p>{canInviteOrganizations ? "Скопируйте ссылку на форму или отправьте приглашения." : "Скопируйте ссылку на форму."}</p>
                  <div className="responses-page-empty-actions">
                    <button type="button" className="button-primary" onClick={() => void handleCopyFormLink()}>
                      Скопировать ссылку
                    </button>
                    {canInviteOrganizations && (
                      <button type="button" className="app-button" aria-haspopup="dialog" onClick={() => setShareDialog({ formId: form.id, tab: "mail" })}>
                        Отправить приглашения
                      </button>
                    )}
                  </div>
                </>
              ) : !canShareForm && !isTemplateForm(form) && <p>Форма закрыта для ответов.</p>}
            </div>
          ) : <p className="responses-page-error">Форма не найдена или недоступна.</p>
        )}

        {!isLoading && !combinedError && !!rows.length && (
          <div className="responses-page-table-shell" role="region" aria-label="Таблица ответов, прокрутка по горизонтали" tabIndex={0}>
            <table className={`responses-table${isHeaderPinned ? " responses-table-header-pinned" : ""}`}>
              <thead>
                <tr>
                  <th className="responses-table-checkbox-column">
                    <div className="responses-table-header-controls">
                      <button
                        type="button"
                        className="responses-header-pin-button"
                        aria-label={isHeaderPinned ? "Открепить заголовки" : "Закрепить заголовки"}
                        title={isHeaderPinned ? "Открепить заголовки" : "Закрепить заголовки"}
                        aria-pressed={isHeaderPinned}
                        onClick={() => setIsHeaderPinned(pinned => !pinned)}
                      >
                        <img src={pinBlackIcon} className="responses-pin-icon-light" alt="" aria-hidden="true" />
                        <img src={pinWhiteIcon} className="responses-pin-icon-dark" alt="" aria-hidden="true" />
                      </button>
                      <SelectAllResponsesCheckbox
                        checked={allVisibleResponsesSelected}
                        indeterminate={selectedVisibleResponses > 0 && !allVisibleResponsesSelected}
                        onChange={toggleAllVisibleResponses}
                      />
                    </div>
                  </th>
                  {columns.map((column) => {
                    return (
                      <th key={column.key} className={getResponseColumnClassName(column) || undefined}>
                        {column.header}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const response = responses[index];
                  const rowId = response?.id ?? `${id}-${index}`;
                  const previewLabel = getResponsePreviewLabel(row, index, columns);
                  return (
                    <tr
                      key={rowId}
                      className={`responses-table-row-clickable${highlightedResponses.has(rowId) ? " response-row-new" : ""}`}
                      role={response ? "button" : undefined}
                      tabIndex={response ? 0 : undefined}
                      aria-label={response ? `Открыть ${previewLabel}` : undefined}
                      onClick={() => {
                        if (response) {
                          handleOpenResponsePreview(response, row, index);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (response) {
                          handleResponseRowKeyDown(event, response, row, index);
                        }
                      }}
                    >
                      <td
                        className="responses-table-checkbox-column"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {response && (
                          <input
                            type="checkbox"
                            aria-label={`Выбрать ${previewLabel}`}
                            checked={selectedResponseIds.has(response.id)}
                            onChange={() => toggleResponseSelection(response.id)}
                          />
                        )}
                      </td>
                      {columns.map((column) => {
                        return (
                          <td
                            key={column.key}
                            className={getResponseColumnClassName(column) || undefined}
                          >
                            {renderResponseCell(column, row[column.key] ?? "")}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !combinedError && totalResponses > 0 && (
          <div className="responses-page-footer">
            <p className="responses-page-total" aria-live="polite">Ответов: {totalResponses}</p>
            {totalPages > 1 && (
              <nav aria-label="Страницы ответов" className="responses-pagination">
                <button type="button" className="button" disabled={page <= 1 || isRefreshing} onClick={() => setPage(current => current - 1)}>Назад</button>
                <span aria-live="polite">Страница {page} из {totalPages}</span>
                <button type="button" className="button" disabled={page >= totalPages || isRefreshing} onClick={() => setPage(current => current + 1)}>Далее</button>
              </nav>
            )}
          </div>
        )}
      </div>

      {form && shareDialog?.formId === form.id && (
        <Suspense fallback={<p role="status">Открываем окно «Поделиться формой»…</p>}>
          <ShareFormModal key={form.id} form={form} initialTab={shareDialog.tab} onClose={() => setShareDialog(null)} />
        </Suspense>
      )}
      <Presence kind="drawer">{preview && formQuery.data && (
        <ResponsePreviewSheet key={preview.response.id} form={formQuery.data} response={preview.response}
          label={preview.label}
          initialPageNo={getFirstAnsweredPageNo(formQuery.data.schema, preview.response.data)}
          onClose={closeResponsePreview} />
      )}</Presence>
      <Presence kind="modal">{responseReport && (
        <ResponseReportModal
          report={responseReport}
          formId={id}
          organizationTypes={formOrganizationTypes}
          canSendReminders={Boolean(user && formQuery.data?.author_id === user.id)}
          onClose={() => setResponseReport(null)}
        />
      )}</Presence>
    </div>
  );
}
