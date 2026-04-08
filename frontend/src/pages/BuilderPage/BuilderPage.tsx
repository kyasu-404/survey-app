import { useParams } from "react-router-dom";
import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

export default function BuilderPage() {
  const { id } = useParams();
  const title = id ? "Редактирование формы" : "Создание формы";

  return (
    <div className="builder-page builder-page-shell">
      <section className="card builder-page-intro" aria-labelledby="builder-page-title">
        <p className="page-kicker">Конструктор форм</p>
        <h1 className="builder-page-title" id="builder-page-title">
          {title}
        </h1>
        <p className="builder-page-subtitle">
          Соберите структуру, проверьте preview и публикуйте форму после проверки.
        </p>
      </section>
      <div className="builder-container">
        <SurveyBuilder formId={id} />
      </div>
    </div>
  );
}
