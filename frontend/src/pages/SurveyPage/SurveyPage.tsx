import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router-dom";
import { getPublicFormById } from "../../entities/survey/api/surveysApi";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";

export default function SurveyPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isPreviewMode = searchParams.get("mode") === "preview";
  const subtitle = isPreviewMode
    ? "Режим предварительного просмотра. Отправка ответа отключена."
    : "Заполните форму и отправьте ответ, когда будете готовы.";

  const {
    data: form,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["survey-form", id],
    queryFn: async () => {
      if (!id) {
        return null;
      }

      return getPublicFormById(id);
    },
    enabled: Boolean(id),
  });

  const errorMessage = useMemo(() => {
    if (!error) {
      return null;
    }

    return error instanceof Error
      ? error.message
      : "Не удалось загрузить форму. Проверьте доступ к форме и повторите попытку.";
  }, [error]);

  if (!id) return <p>Форма не найдена.</p>;
  if (isLoading) return <p>Загрузка...</p>;
  if (errorMessage) return <p>Ошибка: {errorMessage}</p>;
  if (!form) return <p>Форма не найдена или недоступна.</p>;

  return (
    <div className="survey-page survey-page-shell">
      <section className="survey-page-hero card" aria-label="Публичная форма">
        <p className="survey-page-kicker">Публичная форма</p>
        <h1 className="survey-page-title">{form.title}</h1>
        <p className="survey-page-subtitle">{subtitle}</p>
      </section>
      <div className={`survey-page-card card ${isPreviewMode ? "survey-page-card-preview" : ""}`.trim()}>
        <SurveyRenderer schema={form.schema} formId={form.id} isPreviewMode={isPreviewMode} />
      </div>
    </div>
  );
}
