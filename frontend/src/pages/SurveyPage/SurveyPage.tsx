import { Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { getFormById, getPublicFormById } from "../../entities/survey/api/surveysApi";
import {
  getPrivateSurveyFormQueryKey,
  getPublicSurveyFormQueryKey,
} from "../../entities/survey/model/queryKeys";
import { isAbortError } from "../../shared/lib/error";
import { Skeleton } from "../../shared/ui/Skeleton";
import { LazySurveyRenderer } from "../../widgets/SurveyRenderer/LazySurveyRenderer";
import { SurveyRuntimeSurface } from "../../widgets/SurveyRenderer/SurveyRuntimeSurface";
import type { SurveyRenderMode } from "../../features/render-form/SurveyFormRenderer";

function SurveyNotFound() {
  return (
    <div className="survey-not-found-page">
      <div className="survey-not-found-card card">
        <h1 className="survey-not-found-title">404</h1>
        <p className="survey-not-found-copy">Форма не найдена или недоступна.</p>
      </div>
    </div>
  );
}

function SurveyRendererFallback() {
  return (
    <div className="survey-page-skeleton-fields" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={`survey-renderer-skeleton-${index}`} className="survey-page-skeleton-field">
          <Skeleton className="survey-page-skeleton-label" />
          <Skeleton className="survey-page-skeleton-input" />
        </div>
      ))}
    </div>
  );
}

function getRouteRenderMode(state: unknown): SurveyRenderMode {
  if (!state || typeof state !== "object") {
    return "interactive";
  }

  if ("renderMode" in state && state.renderMode === "readonly-navigable") {
    return "readonly-navigable";
  }

  if ("renderMode" in state && state.renderMode === "preview-navigable") {
    return "preview-navigable";
  }

  if ("renderMode" in state && state.renderMode === "readonly-static") {
    return "readonly-static";
  }

  if ("isPreview" in state && state.isPreview === true) {
    return "preview-navigable";
  }

  return "interactive";
}

export default function SurveyPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user, loading: isAuthLoading } = useAuth();
  const renderMode = getRouteRenderMode(location.state);
  const isPreview = renderMode !== "interactive";

  const isPrivatePreview = isPreview;
  const surveyQuery = useQuery({
    queryKey: isPrivatePreview ? getPrivateSurveyFormQueryKey(id) : getPublicSurveyFormQueryKey(id),
    queryFn: async ({ signal }) => {
      if (!id) {
        return null;
      }

      if (isPrivatePreview) {
        return getFormById(id, { signal });
      }

      return getPublicFormById(id, { signal });
    },
    enabled: isPrivatePreview ? Boolean(id) && !isAuthLoading && Boolean(user?.id) : Boolean(id),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
  const form = surveyQuery.data;
  const showInitialSkeleton = !form && (surveyQuery.isLoading || (isPrivatePreview && isAuthLoading));

  const errorMessage = useMemo(() => {
    if (!surveyQuery.error || isAbortError(surveyQuery.error)) {
      return null;
    }

    return surveyQuery.error instanceof Error
      ? surveyQuery.error.message
      : "Не удалось загрузить форму. Проверьте доступ к форме и повторите попытку.";
  }, [surveyQuery.error]);

  if (!id) return <SurveyNotFound />;
  if (showInitialSkeleton) {
    return (
      <div className="survey-page survey-page-shell">
        <SurveyRuntimeSurface className="card survey-page-skeleton">
          <Skeleton className="survey-page-skeleton-title" />
          <Skeleton className="survey-page-skeleton-copy" />
          <Skeleton className="survey-page-skeleton-copy survey-page-skeleton-copy-short" />
          <div className="survey-page-skeleton-fields">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={`survey-skeleton-${index}`} className="survey-page-skeleton-field">
                <Skeleton className="survey-page-skeleton-label" />
                <Skeleton className="survey-page-skeleton-input" />
              </div>
            ))}
          </div>
          <Skeleton className="survey-page-skeleton-button" />
        </SurveyRuntimeSurface>
      </div>
    );
  }
  if (errorMessage) return <p>Ошибка: {errorMessage}</p>;
  if (isPrivatePreview && !user?.id) return <SurveyNotFound />;
  if (!form || (!form.is_public && !isPreview)) return <SurveyNotFound />;

  return (
    <div className="survey-page survey-page-shell">
      <SurveyRuntimeSurface className="card">
        <Suspense fallback={<SurveyRendererFallback />}>
          <LazySurveyRenderer
            schema={form.schema}
            theme={form.theme}
            formId={form.id}
            respondentId={user?.id}
            renderMode={renderMode}
            isPreview={isPreview}
            allowAnonymousUploads={form.is_public}
            allowResponseEditing={form.allow_response_editing ?? false}
          />
        </Suspense>
      </SurveyRuntimeSurface>
    </div>
  );
}
