import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getResponsesByForm } from "../../entities/response/api";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import downloadIcon from "../../img/Download.svg";
import printerIcon from "../../img/printer.svg";
import { RESPONSES_PAGE_SIZE } from "../../shared/api";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import {
  createResponsesHtmlDocument,
  createResponsesHtmlReport,
  downloadHtmlDocument,
  formatResponsesForTable,
} from "../../shared/lib/responsesExport";
import { Skeleton } from "../../shared/ui/Skeleton";

export default function FormResponsesHtmlPage() {
  const { id } = useParams();

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
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const responsesQuery = useQuery({
    queryKey: getFormResponsesQueryKey(id, "html", RESPONSES_PAGE_SIZE),
    queryFn: async ({ signal }) => {
      if (!id) {
        return {
          data: [],
          count: 0,
          page: 1,
          pageSize: RESPONSES_PAGE_SIZE,
          totalPages: 1,
        };
      }

      return getResponsesByForm(id, { page: 1, pageSize: RESPONSES_PAGE_SIZE, signal });
    },
    enabled: Boolean(id),
    retry: 1,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const responses = responsesQuery.data?.data ?? [];
  const rows = useMemo(
    () => (formQuery.data ? formatResponsesForTable(responses, formQuery.data.schema) : []),
    [formQuery.data, responses],
  );
  const formTitle = formQuery.data?.title ?? "Ответы формы";
  const totalResponses = responsesQuery.data?.count ?? 0;
  const shownResponses = rows.length;
  const generatedAt = useMemo(() => new Date(), [formTitle, rows]);
  const htmlDocument = useMemo(
    () => createResponsesHtmlDocument({ title: formTitle, rows, generatedAt }),
    [formTitle, generatedAt, rows],
  );
  const htmlPreview = useMemo(
    () => createResponsesHtmlReport({ title: formTitle, rows, generatedAt }),
    [formTitle, generatedAt, rows],
  );
  const isLoading = formQuery.isLoading || responsesQuery.isLoading;
  const combinedError = [formQuery.error, responsesQuery.error].find((error) => error && !isAbortError(error)) ?? null;
  const canUseHtml = !isLoading && !combinedError;

  const handleDownload = () => {
    downloadHtmlDocument(htmlDocument, `ответы-${formTitle}`);
  };

  const handlePrint = () => {
    window.print();
  };

  if (!id) {
    return <p>Форма не найдена.</p>;
  }

  return (
    <main className="responses-html-page">
      <div className="responses-html-actions" aria-label="Действия HTML">
        <button type="button" className="responses-export-button" onClick={handleDownload} disabled={!canUseHtml}>
          <span>Скачать HTML</span>
          <img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" />
        </button>
        <button
          type="button"
          className="responses-export-button responses-print-button responses-print-button-secondary"
          onClick={handlePrint}
          disabled={!canUseHtml}
        >
          <span>Печать</span>
          <img src={printerIcon} alt="" aria-hidden="true" className="toolbar-icon" />
        </button>
      </div>

      {isLoading && (
        <div className="responses-html-preview responses-page-skeleton" aria-hidden="true">
          <Skeleton className="responses-page-skeleton-cell" />
          <Skeleton className="responses-page-skeleton-cell" />
          <Skeleton className="responses-page-skeleton-cell" />
        </div>
      )}

      {!isLoading && combinedError && (
        <p className="responses-page-error">{getErrorMessage(combinedError, "Не удалось загрузить ответы")}</p>
      )}

      {!isLoading && !combinedError && (
        <>
          {totalResponses > shownResponses && (
            <p className="responses-page-limit-note">Показаны первые {shownResponses} из {totalResponses}.</p>
          )}
          <div
            className="responses-html-preview"
            dangerouslySetInnerHTML={{
              __html: htmlPreview,
            }}
          />
        </>
      )}
    </main>
  );
}
