import { useAuth } from "../../app/providers/AuthProvider";
import { NotificationPreferences } from "../../entities/notification/NotificationPreferences";

export default function PreferencesPage() {
  const { user } = useAuth();
  return <div className="dashboard-page">
    <section className="card activity-page">
      <header className="activity-heading"><h1>Настройки</h1></header>
      {user && <NotificationPreferences key={user.id} userId={user.id} />}
    </section>
  </div>;
}
