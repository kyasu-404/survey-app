import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { cloneForm, getFormById } from "../../entities/survey/api/surveysApi";
import { getFormQueryKey } from "../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

export default function BuilderPage() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCopying, setIsCopying] = useState(false);
  const formQuery = useQuery({
    queryKey: getFormQueryKey(id),
    queryFn: ({ signal }) => getFormById(id ?? "", { signal }),
    enabled: Boolean(id && user),
    retry: 1,
    staleTime: 30_000,
  });

  if (!user) {
    return null;
  }

  const handleCreateCopy = async () => {
    if (!formQuery.data) {
      return;
    }

    setIsCopying(true);
    try {
      const copy = await cloneForm(formQuery.data, user.id);
      await queryClient.invalidateQueries({ queryKey: ["dashboard-form-summaries"] });
      showToast("Копия формы создана", "success");
      navigate(routes.builderEdit(copy.id), { replace: true });
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось создать копию формы"), "error");
    } finally {
      setIsCopying(false);
    }
  };

  if (id && formQuery.isLoading) {
    return (
      <div className="builder-page">
        <div className="builder-container builder-loading-skeleton" aria-hidden="true">
          <Skeleton className="builder-loading-skeleton-line builder-loading-skeleton-line-title" />
          <Skeleton className="builder-loading-skeleton-line" />
        </div>
      </div>
    );
  }

  if (id && formQuery.error) {
    return <p>{getErrorMessage(formQuery.error, "Не удалось открыть форму")}</p>;
  }

  if (id && (formQuery.data?.responses_count ?? 0) > 0) {
    return (
      <div className="builder-page">
        <div className="modal-backdrop builder-answered-warning-backdrop">
          <div className="modal-card card builder-answered-warning" role="alertdialog" aria-modal="true">
            <h3 className="builder-reset-title">У формы уже есть ответы</h3>
            <p className="builder-template-subtitle">
              Создайте её копию, чтобы не нарушить существующие данные.
            </p>
            <div className="deadline-modal-actions">
              <button
                type="button"
                className="deadline-save-button"
                onClick={() => void handleCreateCopy()}
                disabled={isCopying}
              >
                {isCopying && <InlineSpinner />}
                Создать копию
              </button>
              <button
                type="button"
                className="deadline-clear-button"
                onClick={() => navigate(routes.dashboardMy, { replace: true })}
                disabled={isCopying}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="builder-page">
      <div className="builder-container">
        <SurveyBuilder formId={id} userId={user.id} canAdministerAllForms={profile?.role === "admin"} />
      </div>
    </div>
  );
}
