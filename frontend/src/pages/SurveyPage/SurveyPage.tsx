import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { getFormById } from "../../entities/survey/api/surveysApi";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";
import blackLogo from "../../img/black_logo.png";

export default function SurveyPage() {
  const { id } = useParams();

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

      return getFormById(id);
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

  if (!id) return <p>Форма не найдена</p>;
  if (isLoading) return <p>Загрузка...</p>;
  if (errorMessage) return <p>Ошибка: {errorMessage}</p>;
  if (!form) return <p>Форма не найдена или недоступна.</p>;

  return (
    <div className="survey-page">
      <div className="survey-page-card card">
        <div className="survey-page-brand">
          <img src={blackLogo} alt="Логотип ИМЦ" className="survey-page-logo" />
        </div>
        <SurveyRenderer schema={form.schema} formId={form.id} />
      </div>
    </div>
  );
}
