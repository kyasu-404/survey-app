import { AnnouncementContent } from "../../entities/announcement/AnnouncementContent";
import { AnnouncementPromptContents } from "../../entities/announcement/AnnouncementPromptContents";
import { Icon } from "../../shared/ui/Icon";
import "../../widgets/AnnouncementSpotlight/announcementSpotlight.css";
import "../NotificationsPage/notifications.css";
import type { AnnouncementFields } from "./api";

export function AnnouncementPreview({ fields }: { fields: AnnouncementFields }) {
  const { display_mode: mode } = fields;
  const prompt = {
    ...fields, id: "preview", acknowledged_at: null,
    title: fields.title.trim() || "Заголовок объявления",
    message: fields.message.trim() || "Текст объявления",
  };
  return <div className="announcement-previews">
    <section className="notification-center">
      <h3>Центр уведомлений</h3>
      <div className="activity-row activity-row-unread announcement-preview-feed">
        <div className="activity-row-body">
          <div className="activity-row-meta"><span className="activity-unread-dot" />Объявления</div>
          <h2 className="notification-row-title">{prompt.title}</h2>
          <AnnouncementContent message={prompt.message} actionLabel={fields.action_label} actionUrl={fields.action_url} preview />
          {fields.require_acknowledgement && <button type="button" disabled className="app-button notification-ack">Ознакомился</button>}
        </div>
        <button type="button" className="app-button icon-button" disabled aria-label="Отметить прочитанным"><Icon name="check_circle" /></button>
      </div>
    </section>
    {mode !== "feed" && <section>
      <h3>{mode === "banner" ? "Баннер в приложении" : "Окно при входе"}</h3>
      <div className={"announcement-preview-stage announcement-preview-stage-" + mode}>
        <div className={mode === "banner" ? "card announcement-banner" : "card modal-card announcement-dialog"}>
          <AnnouncementPromptContents prompt={prompt} preview />
        </div>
      </div>
    </section>}
  </div>;
}
