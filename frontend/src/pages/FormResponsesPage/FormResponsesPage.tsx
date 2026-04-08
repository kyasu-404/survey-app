import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useToast } from "../../app/providers/ToastProvider";
import { getResponsesByForm } from "../../entities/response/api";
import { formatResponsesForTable } from "../../entities/response/model/responseTable";
import { getFormById } from "../../entities/survey/api/surveysApi";
import infoIcon from "../../img/info.svg";
import refreshIcon from "../../img/refresh.png";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";

const responseDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default function FormResponsesPage() {
  const { id } = useParams();
  const { showToast } = useToast();

  const formQuery = useQuery({
    queryKey: ["form", id],
    queryFn: () => getFormById(id ?? ""),
    enabled: Boolean(id),
    retry: 1,
  });

  const responsesQuery = useQuery({
    queryKey: ["form-responses", id],
    queryFn: () => getResponsesByForm(id ?? ""),
    enabled: Boolean(id),
    retry: 1,
  });

  const responses = responsesQuery.data ?? [];
  const rows = useMemo(() => {
    if (!formQuery.data) {
      return [];
    }

    return formatResponsesForTable(responses, formQuery.data.schema);
  }, [formQuery.data, responses]);

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const isLoading = formQuery.isLoading || responsesQuery.isLoading;
  const isFetching = formQuery.isFetching || responsesQuery.isFetching;
  const combinedError = formQuery.error ?? responsesQuery.error;

  const latestResponse = useMemo(
    () =>
      [...responses].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0] ??
      null,
    [responses],
  );
  const responseCount = responses.length;

  const handleRefresh = async () => {
    await Promise.all([formQuery.refetch(), responsesQuery.refetch()]);
  };

  const handleExport = () => {
    if (!formQuery.data || !rows.length) {
      showToast("Нет данных для выгрузки", "info");
      return;
    }

    exportToExcel(rows, `ответы-${formQuery.data.title}`);
    showToast("Ответы выгружены в XLSX", "success");
  };

  return (
    <div className="dashboard-page dashboard-shell responses-page-shell">
      <section className="card responses-page-hero">
        <div className="responses-page-hero-top">
          <div className="responses-page-hero-copy">
            <p className="page-kicker">Центр ответов</p>
            <h1 className="responses-page-title">{formQuery.data?.title ?? "Ответы формы"}</h1>
            <p className="responses-page-subtitle">
              Сводка по откликам формы, быстрая синхронизация и выгрузка в XLSX без лишних переходов.
            </p>
          </div>
          <div className="responses-page-actions">
            <button
              className="dashboard-refresh-button responses-page-export-button"
              onClick={handleExport}
              disabled={isLoading || !rows.length}
            >
              Выгрузить в XLSX
            </button>
            <button className="dashboard-refresh-button" onClick={() => void handleRefresh()} disabled={isFetching}>
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

        <div className="responses-page-summary-grid" aria-label="Сводка ответов">
          <article className="responses-summary-card">
            <div className="responses-summary-card-header">
              <img src={infoIcon} alt="" aria-hidden="true" className="responses-summary-icon" />
              <span className="responses-summary-label">Всего ответов</span>
            </div>
            <strong className="responses-summary-value">{responseCount}</strong>
            <p className="responses-summary-note">
              {responseCount > 0 ? "Показываем все сохраненные ответы формы." : "Ответы еще не поступали."}
            </p>
          </article>

          <article className="responses-summary-card">
            <div className="responses-summary-card-header">
              <img src={infoIcon} alt="" aria-hidden="true" className="responses-summary-icon" />
              <span className="responses-summary-label">Последний ответ</span>
            </div>
            <strong className="responses-summary-value">
              {latestResponse ? responseDateFormatter.format(new Date(latestResponse.created_at)) : "Пока нет ответов"}
            </strong>
            <p className="responses-summary-note">
              {latestResponse ? "По данным формы с самым свежим откликом." : "Обновите страницу после появления новых ответов."}
            </p>
          </article>
        </div>
      </section>

      <section className="card responses-page-card">
        <div className="responses-page-table-header">
          <div>
            <p className="responses-page-table-kicker">Таблица ответов</p>
            <p className="responses-page-table-note">Фиксируем существующие данные формы и показываем их в одном рабочем списке.</p>
          </div>
        </div>

        {isLoading && <p className="dashboard-loading-text">Загрузка ответов...</p>}
        {!isLoading && combinedError && (
          <p style={{ color: "#b91c1c" }}>{getErrorMessage(combinedError, "Не удалось загрузить ответы формы")}</p>
        )}
        {!isLoading && !combinedError && !rows.length && <p>Ответов пока нет.</p>}
        {!isLoading && !combinedError && !!rows.length && (
          <div className="responses-page-table-wrapper">
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
      </section>
    </div>
  );
}
