import { useAuth } from "../../app/providers/AuthProvider";
import { AnnouncementPromptContents, type AnnouncementPromptContentsProps } from "../../entities/announcement/AnnouncementPromptContents";
import { useNotificationActions } from "../../entities/notification/useNotificationActions";
import { useModalSurface } from "../../shared/ui/useModalSurface";
import { useAnnouncementPrompts } from "./useAnnouncementPrompts";
import "./announcementSpotlight.css";

function AnnouncementModal(props: AnnouncementPromptContentsProps & { onClose: () => void }) {
  const dialog = useModalSurface();
  return <dialog className="card modal-card announcement-dialog" ref={dialog} aria-labelledby={props.titleId}
    onCancel={event => { event.preventDefault(); props.onClose(); }}>
    <AnnouncementPromptContents {...props} />
  </dialog>;
}

function CurrentAnnouncements({ userId }: { userId: string }) {
  const { prompts, dismiss } = useAnnouncementPrompts(userId);
  const { mark, acknowledge } = useNotificationActions(userId);
  return <>{prompts.map(prompt => {
    const onClose = () => {
      dismiss(prompt.id);
      if (!prompt.read_at) mark.mutate(prompt.id);
    };
    const props = { prompt, titleId: "announcement-title-" + prompt.id, onClose, pending: acknowledge.isPending,
      onAcknowledge: () => acknowledge.mutate(prompt.id, { onSuccess: () => dismiss(prompt.id) }) };
    return prompt.display_mode === "modal"
      ? <AnnouncementModal key={prompt.id} {...props} />
      : <section key={prompt.id} className="card announcement-banner" aria-labelledby={props.titleId}>
        <AnnouncementPromptContents {...props} />
      </section>;
  })}</>;
}

export function AnnouncementSpotlight() {
  const { user, loading, profile } = useAuth();
  if (loading || !user || !profile || profile.id !== user.id || profile.is_disabled) return null;
  return <CurrentAnnouncements key={user.id + ":" + profile.role} userId={user.id} />;
}
