import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getResponsesByForm } from "../../entities/response/api";
import { getFormById } from "../../entities/survey/api/surveysApi";
import downloadIcon from "../../img/Download.svg";
import printerIcon from "../../img/printer.svg";
import { getErrorMessage } from "../../shared/lib/error";
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
  const formTitle = formQuery.data?.title ?? "Ответы формы";
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
  const combinedError = formQuery.error ?? responsesQuery.error;
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
          className="responses-export-button responses-print-button responses-print-button-orange"
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
        <div
          className="responses-html-preview"
          dangerouslySetInnerHTML={{
            __html: htmlPreview,
          }}
        />
      )}
    </main>
  );
}
