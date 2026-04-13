import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useToast } from "../../app/providers/ToastProvider";
import { getResponsesByForm } from "../../entities/response/api";
import { getFormById } from "../../entities/survey/api/surveysApi";
import type { SurveyForm } from "../../entities/survey/types";
import downloadIcon from "../../img/Download.svg";
import previewIcon from "../../img/preview.svg";
import refreshIcon from "../../img/refresh.png";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";
import { formatResponsesForTable, getResponseTableHeaders } from "../../shared/lib/responsesExport";
import { Skeleton } from "../../shared/ui/Skeleton";

export default function FormResponsesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

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
                  const rowId = responsesQuery.data?.[index]?.id ?? `${id}-${index}`;
                  return (
                    <tr key={rowId}>
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
    </div>
  );
}
