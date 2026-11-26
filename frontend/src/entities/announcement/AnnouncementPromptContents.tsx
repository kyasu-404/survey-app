import { Icon } from "../../shared/ui/Icon";
import { ModalHeading } from "../../shared/ui/ModalHeading";
import { AnnouncementContent } from "./AnnouncementContent";
import type { AnnouncementPrompt } from "./promptApi";

type Content = Pick<AnnouncementPrompt, "id" | "title" | "message" | "action_label" | "action_url" | "require_acknowledgement" | "acknowledged_at">;
export type AnnouncementPromptContentsProps = {
  prompt: Content;
  titleId?: string;
  onClose?: () => void;
  onAcknowledge?: () => void;
  pending?: boolean;
  preview?: boolean;
};

export function AnnouncementPromptContents({ prompt, titleId, onClose, onAcknowledge, pending, preview }: AnnouncementPromptContentsProps) {
  return <>
    <ModalHeading className="announcement-prompt-heading" label="Закрыть объявление" disabled={preview} onClose={onClose}>
      <div>
        <span className="announcement-source"><Icon name="info" size={16} /> Объявление администрации</span>
        <h2 id={titleId}>{prompt.title}</h2>
      </div>
    </ModalHeading>
    <AnnouncementContent message={prompt.message} actionLabel={prompt.action_label} actionUrl={prompt.action_url} onAction={prompt.require_acknowledgement && !prompt.acknowledged_at && !prompt.action_url?.startsWith("/") ? undefined : onClose} preview={preview} />
    {prompt.require_acknowledgement && !prompt.acknowledged_at &&
      <button className="button-primary announcement-ack" type="button" disabled={preview || pending} onClick={onAcknowledge}>Ознакомился</button>}
  </>;
}
