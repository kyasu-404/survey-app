import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

export default function BuilderPage() {
  return (
    <div className="builder-page">
      <h2 style={{ margin: "4px 0 12px" }}>Конструктор формы</h2>
      <div className="builder-container">
        <SurveyBuilder />
      </div>
    </div>
  );
}
