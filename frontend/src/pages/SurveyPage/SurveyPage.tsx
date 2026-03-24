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

    getFormById(id)
      .then(setForm)
      .catch((e) => setError(e.message));
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
