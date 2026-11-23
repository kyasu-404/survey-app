import { AnnouncementAction, AnnouncementContent } from "../../entities/announcement/AnnouncementContent";
import { AnnouncementPromptContents } from "../../entities/announcement/AnnouncementPromptContents";
import { NotificationCard } from "../../entities/notification/NotificationCard";
import "../../widgets/AnnouncementSpotlight/announcementSpotlight.css";
import type { AnnouncementFields } from "./api";

export function AnnouncementPreview({ fields }: { fields: AnnouncementFields }) {
  const { display_mode: mode } = fields;
  const prompt = {
    ...fields, id: "preview", acknowledged_at: null,
    title: fields.title.trim() || "Заголовок объявления",
    message: fields.message.trim() || "Текст объявления",
    action_url: fields.action_url?.trim() ?? null,
  };
  return <div className="announcement-previews">
    <section>
      <h3>Центр уведомлений</h3>
      <NotificationCard category="announcement" title={prompt.title} unread preview actions={<>
        <AnnouncementAction actionLabel={prompt.action_label} actionUrl={prompt.action_url} preview />
        {fields.require_acknowledgement && <button type="button" disabled className="app-button">Ознакомился</button>}
      </>}>
        <AnnouncementContent message={prompt.message} />
      </NotificationCard>
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
