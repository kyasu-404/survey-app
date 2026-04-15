import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { getFormById, getPublicFormById } from "../../entities/survey/api/surveysApi";
import { getSurveyFormQueryKey } from "../../entities/survey/model/queryKeys";
import { Skeleton } from "../../shared/ui/Skeleton";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";

function SurveyNotFound() {
  return (
    <div className="survey-not-found-page">
      <div className="survey-not-found-card card">
        <p className="survey-not-found-code">404</p>
        <h1 className="survey-not-found-title">404</h1>
        <p className="survey-not-found-copy">Форма не найдена или недоступна.</p>
      </div>
    </div>
  );
}

export default function SurveyPage() {
  const { id } = useParams();
  const location = useLocation();
  const { user, loading: isAuthLoading } = useAuth();
  const isPreview = Boolean(
    location.state &&
      typeof location.state === "object" &&
      "isPreview" in location.state &&
      location.state.isPreview === true,
  );

  const {
    data: form,
    isLoading,
    error,
  } = useQuery({
    queryKey: getSurveyFormQueryKey(id),
    queryFn: async () => {
      if (!id) {
        return null;
      }

      if (user?.id) {
        return getFormById(id);
      }

      return getPublicFormById(id);
    },
    enabled: Boolean(id) && !isAuthLoading,
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }

    return error instanceof Error
      ? error.message
      : "Не удалось загрузить форму. Проверьте доступ к форме и повторите попытку.";
  }, [error]);

  if (!id) return <SurveyNotFound />;
  if (isLoading || isAuthLoading) {
    return (
      <div className="survey-page survey-page-shell">
        <div className="survey-page-card card survey-page-skeleton">
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
        </div>
      </div>
    );
  }
  if (errorMessage) return <p>Ошибка: {errorMessage}</p>;
  if (!form || (!form.is_public && !isPreview)) return <SurveyNotFound />;

  return (
    <div className="survey-page survey-page-shell">
      <div className="survey-page-card card">
        <SurveyRenderer
          schema={form.schema}
          formId={form.id}
          isPreview={isPreview}
          allowAnonymousUploads={form.is_public}
        />
      </div>
    </div>
  );
}
