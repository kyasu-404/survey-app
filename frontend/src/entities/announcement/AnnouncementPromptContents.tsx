import { Icon } from "../../shared/ui/Icon";
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
    <header className="announcement-prompt-heading">
      <div>
        <span className="announcement-source"><Icon name="info" size={16} /> Объявление администрации</span>
        <h2 id={titleId}>{prompt.title}</h2>
      </div>
      <button className="app-button icon-button" type="button" aria-label="Закрыть объявление" disabled={preview} onClick={onClose}><Icon name="close" /></button>
    </header>
    <AnnouncementContent message={prompt.message} actionLabel={prompt.action_label} actionUrl={prompt.action_url} onAction={onClose} preview={preview} />
    {prompt.require_acknowledgement && !prompt.acknowledged_at &&
      <button className="button-primary announcement-ack" type="button" disabled={preview || pending} onClick={onAcknowledge}>Ознакомился</button>}
  </>;
}
