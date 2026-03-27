import { useParams } from "react-router-dom";
import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";

export default function BuilderPage() {
  const { id } = useParams();

  return (
    <div className="builder-page">
      <div className="builder-container">
        <SurveyBuilder formId={id} />
      </div>
    </div>
  );
}
