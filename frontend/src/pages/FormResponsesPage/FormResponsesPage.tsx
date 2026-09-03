import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useToast } from "../../app/providers/ToastProvider";
import { useAuth } from "../../app/providers/AuthProvider";
import { getOrganizations } from "../../entities/organization/api";
import {
  getOrganizationDisplayName,
  hasOrganizationQuestion,
  normalizeOrganizationTypes,
} from "../../entities/organization/model";
import { deleteResponses, getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { getFormReasonLabel, getFormTypeLabel } from "../../entities/survey/model/formOptions";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import type { SurveyForm, SurveySchema } from "../../entities/survey/types";
import downloadIcon from "../../img/Download.svg";
import useIcon from "../../img/use.svg";
import deleteIcon from "../../img/delete.svg";
import infoIcon from "../../img/info.svg";
import { MAX_CLIENT_RESPONSE_EXPORT, supabaseClient } from "../../shared/api";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";
import { scheduleDebouncedQueryInvalidation } from "../../shared/lib/queryRefresh";
import type { ResponsesTableRow } from "../../shared/lib/responsesExport";
import { formatResponsesForTable, getResponseTableHeaders } from "../../shared/lib/responsesExport";
import { createResponseReport, type ResponseReport } from "../../shared/lib/responseReport";
import { RefreshButton } from "../../shared/ui/RefreshButton";
import { Skeleton } from "../../shared/ui/Skeleton";
import { LazySurveyRenderer } from "../../widgets/SurveyRenderer/LazySurveyRenderer";
import { SurveyRuntimeSurface } from "../../widgets/SurveyRenderer/SurveyRuntimeSurface";
import { ResponseReportModal } from "./ResponseReportModal";

type SelectedResponsePreview = {
  label: string;
  response: SurveyResponse;
};

const RESPONSES_SCROLL_PAGE_SIZE = 100;
type ResponsesPage = Awaited<ReturnType<typeof getResponsesByForm>>;

function getResponsePreviewLabel(row: ResponsesTableRow, index: number) {
  const primaryValue = Object.entries(row).find(
    ([header, value]) => header !== "Дата ответа" && value.trim().length > 0,
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

async function getResponsePage(
  formId: string,
  page: number,
  signal?: AbortSignal,
) {
  return getResponsesByForm(formId, {
    page,
    pageSize: RESPONSES_SCROLL_PAGE_SIZE,
    signal,
  });
}

async function getAllResponsesForExport(
  formId: string,
  firstPage: ResponsesPage,
) {
  const pageSize = firstPage.pageSize || RESPONSES_SCROLL_PAGE_SIZE;
  const responses = [...firstPage.data];
  let currentPage = firstPage;

  for (;;) {
    if (currentPage.data.length < pageSize) return responses;
    currentPage = await getResponsesByForm(formId, { page: currentPage.page + 1, pageSize });
    if (responses.length + currentPage.data.length > MAX_CLIENT_RESPONSE_EXPORT) {
      throw new Error(`В одной клиентской выгрузке поддерживается не более ${MAX_CLIENT_RESPONSE_EXPORT} ответов`);
    }
    responses.push(...currentPage.data);
  }
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
      aria-label="Выбрать все ответы на странице"
      checked={checked}
      onChange={onChange}
    />
  );
}

function renderResponseCell(header: string, value: string) {
  if (header !== "Дата ответа") {
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
  const { showToast } = useToast();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [selectedResponsePreview, setSelectedResponsePreview] = useState<SelectedResponsePreview | null>(null);
  const [selectedResponseIds, setSelectedResponseIds] = useState<Set<string>>(() => new Set());
  const [isDeletingResponses, setIsDeletingResponses] = useState(false);
  const [responseReport, setResponseReport] = useState<ResponseReport | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [responsePage, setResponsePage] = useState(1);
  const responsesQueryKey = getFormResponsesQueryKey(
    id,
    "page",
    responsePage,
    RESPONSES_SCROLL_PAGE_SIZE,
  );

  useEffect(() => {
    setSelectedResponsePreview(null);
    setSelectedResponseIds(new Set());
    setResponsePage(1);
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
        return {
          data: [],
          count: 0,
          page: 1,
          pageSize: RESPONSES_SCROLL_PAGE_SIZE,
          totalPages: 1,
        };
      }

      return getResponsePage(id, responsePage, signal);
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
  const formOrganizationTypes = normalizeOrganizationTypes(formQuery.data?.organization_types);
  const organizationsQuery = useQuery({
    queryKey: ["education-organizations", "form", id, ...formOrganizationTypes],
    queryFn: ({ signal }) => getOrganizations(formOrganizationTypes, signal),
    enabled: Boolean(id && usesOrganizationDirectory),
    staleTime: 30_000,
  });

  const responses = responsesQuery.data?.data ?? [];
  const organizationLabels = useMemo(
    () => new Map(
      (organizationsQuery.data ?? []).map((organization) => [
        organization.id,
        getOrganizationDisplayName(organization),
      ]),
    ),
    [organizationsQuery.data],
  );
  const rows = useMemo(
    () => (formQuery.data
      ? formatResponsesForTable(responses, formQuery.data.schema, organizationLabels)
      : []),
    [formQuery.data, organizationLabels, responses],
  );

  const headers = getResponseTableHeaders(rows);
  const isLoading =
    (!formQuery.data || !responsesQuery.data) && (formQuery.isLoading || responsesQuery.isLoading);
  const isRefreshing = formQuery.isFetching || responsesQuery.isFetching || organizationsQuery.isFetching;
  const lastUpdatedAt = Math.max(
    formQuery.dataUpdatedAt ?? 0,
    responsesQuery.dataUpdatedAt ?? 0,
    organizationsQuery.dataUpdatedAt ?? 0,
  );
  const combinedError = [formQuery.error, responsesQuery.error, organizationsQuery.error]
    .find((error) => error && !isAbortError(error)) ?? null;
  const totalResponses = formQuery.data?.responses_count ?? responsesQuery.data?.count ?? 0;
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

    const realtimeRefreshTargets = [
      { queryKey: getFormQueryKey(id) },
      { queryKey: getFormResponsesQueryKey(id) },
    ];
    const refreshResponses = () => {
      scheduleDebouncedQueryInvalidation(
        queryClient,
        `form responses realtime ${id}`,
        realtimeRefreshTargets,
        100,
        { cancelRefetch: false, refetchType: "active" },
      );
    };

    const channel = supabaseClient
      .channel(`form-responses:${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "responses",
          filter: `form_id=eq.${id}`,
          select: ["id", "form_id", "data", "created_at", "updated_at"],
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
        refreshResponses,
      )
      .subscribe((status) => {
        console.info("[realtime] form responses channel status", {
          formId: id,
          status,
        });
      });

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [id, queryClient]);

  const handleExport = () => {
    if (!id || !formQuery.data || !responsesQuery.data || !rows.length) {
      showToast("Нет данных для выгрузки", "warning");
      return;
    }

    const formTitle = (formQuery.data as SurveyForm | null)?.title ?? "форма";
    void Promise.resolve(getAllResponsesForExport(id, responsesQuery.data))
      .then((exportResponses) => formatResponsesForTable(
        exportResponses,
        formQuery.data!.schema,
        organizationLabels,
      ))
      .then((exportRows) => exportToExcel(exportRows, `ответы-${formTitle}`))
      .then(() => {
        showToast("Ответы выгружены в XLSX", "success");
      })
      .catch((error) => {
        showToast(getErrorMessage(error, "Не удалось выгрузить ответы"), "error");
      });
  };

  const handleOpenReport = async () => {
    if (!id || !formQuery.data || !responsesQuery.data) {
      return;
    }

    setIsGeneratingReport(true);
    try {
      const reportResponses = await getAllResponsesForExport(id, responsesQuery.data);
      const reportOrganizations = usesOrganizationDirectory
        ? organizationsQuery.data ?? await getOrganizations(formOrganizationTypes)
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

  const handleOpenResponsePreview = (response: SurveyResponse, row: ResponsesTableRow, index: number) => {
    setSelectedResponsePreview({
      label: getResponsePreviewLabel(row, index),
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
      await Promise.all([formQuery.refetch(), responsesQuery.refetch()]);
      showToast(`Удалено ответов: ${selectedCount}`, "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось удалить ответы"), "error");
    } finally {
      setIsDeletingResponses(false);
    }
  };

  if (!id) {
    return <p>Форма не найдена.</p>;
  }

  return (
    <div className="dashboard-page">
      <div className="card responses-page-card">
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
            <button type="button" className="responses-export-button" onClick={handleExport} disabled={isLoading}>
              <span>Скачать XLSX</span>
              <img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <button
              type="button"
              className="responses-export-button responses-html-button"
              onClick={handleOpenHtml}
              disabled={isLoading}
            >
              <span>HTML</span>
              <img src={useIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <button
              type="button"
              className="responses-export-button responses-report-button"
              onClick={() => void handleOpenReport()}
              disabled={isLoading || isGeneratingReport}
            >
              <span>{isGeneratingReport ? "Формирование…" : "Отчёт"}</span>
              <img src={infoIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <RefreshButton
              isRefreshing={isRefreshing}
              lastUpdatedAt={lastUpdatedAt}
              onClick={() => {
                void formQuery.refetch();
                void responsesQuery.refetch();
                if (usesOrganizationDirectory) void organizationsQuery.refetch();
              }}
              disabled={isRefreshing}
            />
          </div>
        </div>

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
              <img src={deleteIcon} alt="" aria-hidden="true" className="toolbar-icon" />
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
          <div className="dashboard-empty-state responses-page-empty">
            <h4>Ответов пока нет</h4>
            <p>Новые ответы появятся здесь автоматически после отправки формы.</p>
          </div>
        )}

        {!isLoading && !combinedError && !!rows.length && (
          <div className="responses-page-table-shell">
            <table className="responses-table">
              <thead>
                <tr>
                  {canDeleteResponses && (
                    <th className="responses-table-checkbox-column">
                      <SelectAllResponsesCheckbox
                        checked={allVisibleResponsesSelected}
                        indeterminate={selectedVisibleResponses > 0 && !allVisibleResponsesSelected}
                        onChange={toggleAllVisibleResponses}
                      />
                    </th>
                  )}
                  {headers.map((header) => {
                    const isDateColumn = header === "Дата ответа";
                    return (
                      <th key={header} className={isDateColumn ? "responses-table-date-column" : undefined}>
                        {header}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const response = responses[index];
                  const rowId = response?.id ?? `${id}-${index}`;
                  const previewLabel = getResponsePreviewLabel(row, index);
                  return (
                    <tr
                      key={rowId}
                      className="responses-table-row-clickable"
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
                      {canDeleteResponses && (
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
                      )}
                      {headers.map((header, columnIndex) => {
                        const isDateColumn = header === "Дата ответа";
                        return (
                          <td
                            key={`${rowId}-${header}-${columnIndex}`}
                            className={isDateColumn ? "responses-table-date-column" : undefined}
                          >
                            {renderResponseCell(header, row[header])}
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
            {(responsesQuery.data?.totalPages ?? 1) > 1 && (
              <div className="responses-page-pagination" aria-label="Страницы ответов">
                <button type="button" disabled={responsePage <= 1} onClick={() => setResponsePage((page) => page - 1)}>
                  Назад
                </button>
                <span>{responsePage} из {responsesQuery.data?.totalPages}</span>
                <button
                  type="button"
                  disabled={responsePage >= (responsesQuery.data?.totalPages ?? 1)}
                  onClick={() => setResponsePage((page) => page + 1)}
                >
                  Далее
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {selectedResponsePreview && formQuery.data && (
        <div
          className="response-preview-layer"
          onMouseDown={(event) => event.target === event.currentTarget && setSelectedResponsePreview(null)}
        >
          <aside
            className="response-preview-drawer"
            role="dialog"
            aria-label={selectedResponsePreview.label}
            aria-modal="true"
          >
            <div className="response-preview-header">
              <div>
                <span className="dashboard-status-pill dashboard-status-pill-active">Ответ</span>
              </div>
              <button type="button" className="response-preview-close" onClick={() => setSelectedResponsePreview(null)}>
                Закрыть
              </button>
            </div>
            <SurveyRuntimeSurface className="response-preview-body response-preview-builder-palette">
              <Suspense fallback={<Skeleton className="response-preview-renderer-skeleton" />}>
                <LazySurveyRenderer
                  schema={{
                    ...formQuery.data.schema,
                    title: formQuery.data.title,
                  }}
                  theme={formQuery.data.theme}
                  formId={formQuery.data.id}
                  initialData={selectedResponsePreview.response.data}
                  initialPageNo={getFirstAnsweredPageNo(formQuery.data.schema, selectedResponsePreview.response.data)}
                  renderMode="readonly-navigable"
                />
              </Suspense>
            </SurveyRuntimeSurface>
          </aside>
        </div>
      )}
      {responseReport && (
        <ResponseReportModal
          report={responseReport}
          formId={id}
          organizationTypes={formOrganizationTypes}
          canSendReminders={canDeleteResponses}
          onClose={() => setResponseReport(null)}
        />
      )}
    </div>
  );
}
