import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

export default function BuilderPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 32px)" }}>
      <h2>Конструктор формы</h2>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SurveyBuilder />
      </div>
    </div>
  );
}
