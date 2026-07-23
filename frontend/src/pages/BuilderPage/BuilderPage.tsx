import { useParams } from "react-router-dom";
import { SurveyBuilder } from "../../widgets/SurveyBuilder/SurveyBuilder";
import { useAuth } from "../../app/providers/AuthProvider";

export default function BuilderPage() {
  const { id } = useParams();
  const { user, profile } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="builder-page">
      <div className="builder-container">
        <SurveyBuilder formId={id} userId={user.id} canAdministerAllForms={profile?.role === "admin"} />
      </div>
    </div>
  );
}
