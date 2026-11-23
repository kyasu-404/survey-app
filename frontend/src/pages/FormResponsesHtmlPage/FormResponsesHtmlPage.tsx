import { Icon } from "../../shared/ui/Icon";
import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { getOrganizations } from "../../entities/organization/api";
import {
  getOrganizationDisplayName,
  hasOrganizationQuestion,
} from "../../entities/organization/model";
import { getAllResponsesByForm } from "../../entities/response/api";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import printerIcon from "../../img/printer.svg";

import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import {
  createResponsesHtmlDocument,
  createResponsesHtmlReport,
  downloadHtmlDocument,
  formatResponsesForTable,
} from "../../entities/response/lib/responsesExport";
import { Skeleton } from "../../shared/ui/Skeleton";
import { RESPONSES_HTML_LAYOUT_CSS } from "../../shared/lib/responsesHtmlLayout";

const RESPONSES_PER_PREVIEW_PAGE = 200;

export default function FormResponsesHtmlPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [pageSelection, setPageSelection] = useState<{ formId?: string; page: number }>({ page: 1 });
  const [isPrinting, setIsPrinting] = useState(() => window.matchMedia?.("print").matches ?? false);

  useEffect(() => {
    const beforePrint = () => flushSync(() => setIsPrinting(true));
    const afterPrint = () => setIsPrinting(false);
    const media = window.matchMedia?.("print");
    const onPrintMediaChange = (event: MediaQueryListEvent) => setIsPrinting(event.matches);
    media?.addEventListener("change", onPrintMediaChange);
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    return () => {
      media?.removeEventListener("change", onPrintMediaChange);
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
    };
  }, []);


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
    queryKey: getFormResponsesQueryKey(id, "html"),
    queryFn: async ({ signal }) => {
      if (!id) {
        return [];
      }

      return getAllResponsesByForm(id, { signal });
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
  const organizationsQuery = useQuery({
    queryKey: ["education-organizations", "history", id],
    queryFn: ({ signal }) => getOrganizations(undefined, signal, true),
    enabled: Boolean(id && usesOrganizationDirectory),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const responses = responsesQuery.data ?? [];
  const organizationLabels = useMemo(
    () => new Map(
      (organizationsQuery.data ?? []).map((organization) => [
        organization.id,
        getOrganizationDisplayName(organization),
      ]),
    ),
    [organizationsQuery.data],
  );
  const table = useMemo(
    () => (formQuery.data
      ? formatResponsesForTable(responses, formQuery.data.schema, organizationLabels)
      : { rows: [], columns: [] }),
    [formQuery.data, organizationLabels, responses],
  );
  const formTitle = formQuery.data?.title ?? "Ответы формы";
  const generatedAt = useMemo(() => new Date(), [formTitle, table]);
  const pageCount = Math.max(1, Math.ceil(table.rows.length / RESPONSES_PER_PREVIEW_PAGE));
  const currentPage = pageSelection.formId === id ? Math.min(pageSelection.page, pageCount) : 1;
  const htmlPreview = useMemo(() => {
    const input = { title: formTitle, ...table, generatedAt };
    if (isPrinting) return createResponsesHtmlReport(input, { layout: "print" });
    const start = (currentPage - 1) * RESPONSES_PER_PREVIEW_PAGE;
    return createResponsesHtmlReport({ ...input, rows: table.rows.slice(start, start + RESPONSES_PER_PREVIEW_PAGE) }, {
      layout: "screen", totalResponses: table.rows.length,
    });
  }, [currentPage, formTitle, generatedAt, isPrinting, table]);
  const isLoading = formQuery.isLoading
    || responsesQuery.isLoading
    || (usesOrganizationDirectory && organizationsQuery.isLoading);
  const combinedError = [formQuery.error, responsesQuery.error, organizationsQuery.error]
    .find((error) => error && !isAbortError(error)) ?? null;
  const canUseHtml = !isLoading && !combinedError;

  const handleDownload = () => {
    const input = { title: formTitle, ...table, generatedAt };
    const htmlDocument = createResponsesHtmlDocument(input, createResponsesHtmlReport(input));
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
      <style>{RESPONSES_HTML_LAYOUT_CSS}</style>
      <div className="responses-html-actions" aria-label="Действия HTML">
        <Link
          className="responses-back-link"
          to={routes.formResponses(id)}
          replace
          onClick={(event) => {
            if (state?.fromResponses !== true) return;
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(-1);
          }}
        >
          <Icon name="arrow_back" size={18} />
          Назад к ответам
        </Link>
        <button type="button" className="responses-export-button" onClick={handleDownload} disabled={!canUseHtml}>
          <span>Скачать HTML</span>
          <Icon name="download" size={18} className="toolbar-icon" />
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

      {canUseHtml && (
        <>
          <div
            className="responses-html-preview"
            dangerouslySetInnerHTML={{ __html: htmlPreview }}
          />
          {pageCount > 1 && !isPrinting && (
            <nav className="responses-pagination" aria-label="Страницы предпросмотра ответов">
              <button type="button" className="button" disabled={currentPage <= 1}
                onClick={() => setPageSelection({ formId: id, page: currentPage - 1 })}>Назад</button>
              <span aria-live="polite">Страница {currentPage} из {pageCount}</span>
              <button type="button" className="button" disabled={currentPage >= pageCount}
                onClick={() => setPageSelection({ formId: id, page: currentPage + 1 })}>Далее</button>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
