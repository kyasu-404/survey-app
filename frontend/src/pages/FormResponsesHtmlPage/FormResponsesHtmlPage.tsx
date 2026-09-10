import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getOrganizations } from "../../entities/organization/api";
import {
  getOrganizationDisplayName,
  hasOrganizationQuestion,
  normalizeOrganizationTypes,
} from "../../entities/organization/model";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { getFormQueryKey, getFormResponsesQueryKey } from "../../entities/survey/model/queryKeys";
import downloadIcon from "../../img/Download.svg";
import printerIcon from "../../img/printer.svg";
import { MAX_CLIENT_RESPONSE_EXPORT, RESPONSES_PAGE_SIZE } from "../../shared/api";
import { getErrorMessage, isAbortError } from "../../shared/lib/error";
import {
  createResponsesHtmlDocument,
  createResponsesHtmlReport,
  downloadHtmlDocument,
  formatResponsesForTable,
} from "../../shared/lib/responsesExport";
import { Skeleton } from "../../shared/ui/Skeleton";
import { RESPONSES_HTML_LAYOUT_CSS } from "../../shared/lib/responsesHtmlLayout";

async function getAllResponses(
  formId: string,
  signal?: AbortSignal,
) {
  const data: SurveyResponse[] = [];
  let page = 1;
  for (;;) {
    signal?.throwIfAborted();
    const result = await getResponsesByForm(formId, {
      page,
      pageSize: RESPONSES_PAGE_SIZE,
      signal,
    });
    if (data.length + result.data.length > MAX_CLIENT_RESPONSE_EXPORT) {
      throw new Error(`HTML-выгрузка ограничена ${MAX_CLIENT_RESPONSE_EXPORT} ответами`);
    }
    data.push(...result.data);
    if (result.data.length < RESPONSES_PAGE_SIZE || data.length >= result.count) return data;
    page += 1;
  }
}

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
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const responsesQuery = useQuery({
    queryKey: getFormResponsesQueryKey(id, "html", RESPONSES_PAGE_SIZE),
    queryFn: async ({ signal }) => {
      if (!id) {
        return [];
      }

      return getAllResponses(id, signal);
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
  const htmlDocument = useMemo(
    () => createResponsesHtmlDocument({ title: formTitle, ...table, generatedAt }),
    [formTitle, generatedAt, table],
  );
  const htmlPreview = useMemo(
    () => createResponsesHtmlReport({ title: formTitle, ...table, generatedAt }),
    [formTitle, generatedAt, table],
  );
  const isLoading = formQuery.isLoading
    || responsesQuery.isLoading
    || (usesOrganizationDirectory && organizationsQuery.isLoading);
  const combinedError = [formQuery.error, responsesQuery.error, organizationsQuery.error]
    .find((error) => error && !isAbortError(error)) ?? null;
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
      <style>{RESPONSES_HTML_LAYOUT_CSS}</style>
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
