import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { NotificationPreferences } from "../../entities/notification/NotificationPreferences";
import { SectionTabs } from "../../shared/ui/SectionTabs";
import { PasswordSettings } from "./PasswordSettings";
import "./preferences.css";

const tabs = [
  { value: "notifications", label: "Уведомления" },
  { value: "security", label: "Безопасность" },
] as const;

export default function PreferencesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "security" ? "security" : "notifications";

  return <div className="dashboard-page">
    <section className="activity-page preferences-page">
      <header className="activity-heading"><h1>Настройки</h1></header>
      {user && <>
        <SectionTabs id="preferences" label="Разделы личных настроек" tabs={tabs} value={tab}
          onChange={next => setParams(current => {
            const updated = new URLSearchParams(current);
            if (next === "security") updated.set("tab", "security");
            else updated.delete("tab");
            return updated;
          }, { replace: true })} />
        <div role="tabpanel" id="preferences-panel-notifications" aria-labelledby="preferences-tab-notifications"
          hidden={tab !== "notifications"}>
          <NotificationPreferences key={user.id} userId={user.id} />
        </div>
        <div role="tabpanel" id="preferences-panel-security" aria-labelledby="preferences-tab-security"
          hidden={tab !== "security"}>
          {tab === "security" && <PasswordSettings key={user.id} />}
        </div>
      </>}
    </section>
  </div>;
}
