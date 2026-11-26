import { ModalHeading } from "../../shared/ui/ModalHeading";
import { Presence } from "../../shared/ui/Presence";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { cloneForm, getFormById } from "../../entities/survey/api/surveysApi";
import { getFormQueryKey } from "../../entities/survey/model/queryKeys";
import { canManageSurveyForm, FORM_EDIT_PERMISSION_ERROR } from "../../entities/survey/model/formAccess";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useLegacyModalDialog } from "../../shared/ui/useLegacyModalDialog";
import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

function AnsweredFormWarningModal({
  isCopying,
  onCancel,
  onConfirmSafeEdit,
  onCreateCopy,
}: {
  isCopying: boolean;
  onCancel: () => void;
  onConfirmSafeEdit: () => void;
  onCreateCopy: () => Promise<void>;
}) {
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isCopying });

  return (
    <div className="modal-backdrop builder-answered-warning-backdrop">
      <div
        ref={dialogRef}
        className="modal-card card builder-answered-warning"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeading onClose={onCancel} disabled={isCopying} lightOnly>
          <h3 id={titleId} className="builder-reset-title">У формы уже есть ответы</h3>
        </ModalHeading>
        <p className="builder-template-subtitle">
          Форму можно открыть в безопасном режиме. Изменение типов вопросов,
          технических идентификаторов и удаление существующих полей будет недоступно.
        </p>
        <div className="deadline-modal-actions">
          <button
            type="button"
            className="deadline-save-button"
            onClick={onConfirmSafeEdit}
            disabled={isCopying}
          >
            Редактировать безопасно
          </button>
          <button
            type="button"
            className="deadline-clear-button"
            onClick={() => void onCreateCopy()}
            disabled={isCopying}
          >
            {isCopying && <InlineSpinner />}
            Создать копию
          </button>
          <button
            type="button"
            className="deadline-action-cancel-button"
            onClick={onCancel}
            disabled={isCopying}
          >
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BuilderPage() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCopying, setIsCopying] = useState(false);
  const isCopyingRef = useRef(false);
  const [confirmedFormId, setConfirmedFormId] = useState<string>();
  const [openedFormId, setOpenedFormId] = useState<string | undefined | null>(null);
  useEffect(() => {
    setConfirmedFormId(undefined);
    setOpenedFormId(null);
  }, [id, user?.id]);
  const canAdministerAllForms = profile?.role === "admin";
  const formQuery = useQuery({
    queryKey: getFormQueryKey(id),
    queryFn: ({ signal }) => getFormById(id ?? "", { signal }),
    enabled: Boolean(id && user),
    retry: 1,
    staleTime: 30_000,
  });

  const responsesCount = formQuery.data?.responses_count ?? 0;
  const showWarning = Boolean(id && responsesCount > 0 && confirmedFormId !== id);
  useEffect(() => {
    if (!showWarning && user && (!id || formQuery.data)) setOpenedFormId(id);
  }, [showWarning, user, id, formQuery.data]);

  if (!user) {
    return null;
  }

  const handleCreateCopy = async () => {
    if (!formQuery.data || !canManageSurveyForm(formQuery.data, user.id, canAdministerAllForms) || isCopyingRef.current) {
      return;
    }

    isCopyingRef.current = true;
    setIsCopying(true);
    try {
      const copy = await cloneForm(formQuery.data, user.id);
      await queryClient.invalidateQueries({ queryKey: ["dashboard-form-summaries"] });
      showToast("Копия формы создана", "success");
      navigate(routes.builderEdit(copy.id), { replace: true });
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось создать копию формы"), "error");
    } finally {
      isCopyingRef.current = false;
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

  if (id && formQuery.error && !formQuery.data) {
    return <p>{getErrorMessage(formQuery.error, "Не удалось открыть форму")}</p>;
  }

  // Cached form data is shared with read-only views; fetching it does not grant edit rights.
  if (id && formQuery.data && !canManageSurveyForm(formQuery.data, user.id, canAdministerAllForms)) {
    return <p role="alert">{FORM_EDIT_PERMISSION_ERROR}</p>;
  }
  if (id && !formQuery.data) return <p role="alert">Форма не найдена</p>;

  return (
    <div className="builder-page">
      <Presence>{showWarning && (
        <AnsweredFormWarningModal
          isCopying={isCopying}
          onConfirmSafeEdit={() => setConfirmedFormId(id)}
          onCreateCopy={handleCreateCopy}
          onCancel={() => navigate(routes.dashboardMy, { replace: true })}
        />
      )}</Presence>
      {(!showWarning || openedFormId === id) && <div className="builder-container" hidden={showWarning}>
        <SurveyBuilder
          key={`${user.id}:${id ?? "new"}`}
          formId={id}
          userId={user.id}
          canAdministerAllForms={canAdministerAllForms}
          safeEditingResponseCount={responsesCount}
        />
      </div>}
    </div>
  );
}
