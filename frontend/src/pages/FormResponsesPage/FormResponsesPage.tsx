import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useToast } from "../../app/providers/ToastProvider";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormById } from "../../entities/survey/api/surveysApi";
import type { SurveyForm } from "../../entities/survey/types";
import downloadIcon from "../../img/Download.svg";
import previewIcon from "../../img/preview.svg";
import refreshIcon from "../../img/refresh.png";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";
import type { ResponsesTableRow } from "../../shared/lib/responsesExport";
import { formatResponsesForTable, getResponseTableHeaders } from "../../shared/lib/responsesExport";
import { Skeleton } from "../../shared/ui/Skeleton";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";

type SelectedResponsePreview = {
  label: string;
  response: SurveyResponse;
};

function getResponsePreviewLabel(row: ResponsesTableRow, index: number) {
  const primaryValue = Object.entries(row).find(
    ([header, value]) => header !== "Дата ответа" && value.trim().length > 0,
  )?.[1];

  return primaryValue ? `Ответ ${primaryValue}` : `Ответ ${index + 1}`;
}

export default function FormResponsesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [selectedResponsePreview, setSelectedResponsePreview] = useState<SelectedResponsePreview | null>(null);

  const formQuery = useQuery({
    queryKey: ["form", id],
    queryFn: async () => {
      if (!id) {
        return null;
      }

      return getFormById(id);
    },
    enabled: Boolean(id),
    retry: 1,
  });

  const responsesQuery = useQuery({
    queryKey: ["form-responses", id],
    queryFn: async () => {
      if (!id) {
        return [];
      }

      return getResponsesByForm(id);
    },
    enabled: Boolean(id),
    retry: 1,
  });

  const rows = useMemo(
    () => (formQuery.data ? formatResponsesForTable(responsesQuery.data ?? [], formQuery.data.schema) : []),
    [formQuery.data, responsesQuery.data],
  );

  const headers = getResponseTableHeaders(rows);
  const isLoading = formQuery.isLoading || responsesQuery.isLoading;
  const isRefreshing = formQuery.isFetching || responsesQuery.isFetching;
  const combinedError = formQuery.error ?? responsesQuery.error;

  const handleExport = () => {
    if (!rows.length) {
      showToast("Нет данных для выгрузки", "warning");
      return;
    }

    const formTitle = (formQuery.data as SurveyForm | null)?.title ?? "форма";
    exportToExcel(rows, `ответы-${formTitle}`);
    showToast("Ответы выгружены в XLSX", "success");
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

  if (!id) {
    return <p>Форма не найдена.</p>;
  }

  return (
    <div className="dashboard-page">
      <div className="card responses-page-card">
        <div className="responses-page-header">
          <div className="responses-page-header-copy">
            <h1 className="responses-page-title">{formQuery.data?.title ?? "Ответы формы"}</h1>
          </div>
          <div className="responses-page-toolbar">
            <button type="button" className="responses-export-button" onClick={handleExport} disabled={isLoading}>
              <span>Выгрузить в XLSX</span>
              <img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <button
              type="button"
              className="responses-export-button responses-html-button"
              onClick={handleOpenHtml}
              disabled={isLoading}
            >
              <span>HTML</span>
              <img src={previewIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <button
              type="button"
              className="dashboard-refresh-button"
              onClick={() => {
                void formQuery.refetch();
                void responsesQuery.refetch();
              }}
              disabled={isRefreshing}
            >
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isRefreshing ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

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
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const response = responsesQuery.data?.[index];
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
                      {headers.map((header, columnIndex) => (
                        <td key={`${rowId}-${header}-${columnIndex}`}>{row[header]}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                <h2 className="response-preview-title">{selectedResponsePreview.label}</h2>
              </div>
              <button type="button" className="response-preview-close" onClick={() => setSelectedResponsePreview(null)}>
                Закрыть
              </button>
            </div>
            <div className="response-preview-body response-preview-builder-palette survey-page-card">
              <SurveyRenderer
                schema={{
                  ...formQuery.data.schema,
                  title: formQuery.data.title,
                }}
                formId={formQuery.data.id}
                initialData={selectedResponsePreview.response.data}
                isPreview
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
