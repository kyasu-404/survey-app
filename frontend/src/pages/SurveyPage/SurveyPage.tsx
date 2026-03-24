import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getFormById } from "../../entities/survey/api/surveysApi";
import type { SurveyForm } from "../../entities/survey/types";
import { SurveyRenderer } from "../../widgets/SurveyRenderer/SurveyRenderer";

export default function SurveyPage() {
  const { id } = useParams();
  const [form, setForm] = useState<SurveyForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setError(null);
    setForm(null);

    getFormById(id)
      .then((nextForm) => {
        if (!nextForm) {
          setError("Форма не найдена или недоступна.");
          return;
        }

        setForm(nextForm);
      })
      .catch((requestError: unknown) => {
        const errorMessage =
          requestError instanceof Error
            ? requestError.message
            : "Не удалось загрузить форму. Проверьте доступ к форме и повторите попытку.";

        setError(errorMessage);
      });
  }, [id]);

  if (!id) return <p>Форма не найдена</p>;
  if (error) return <p>Ошибка: {error}</p>;
  if (!form) return <p>Загрузка...</p>;

  return (
    <div>
      <h2>{form.title}</h2>
      <SurveyRenderer schema={form.schema} formId={form.id} />
    </div>
  );
}
