import { useId } from "react";
import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../../shared/ui/useLegacyModalDialog";
import type { DeadlineEditorState } from "../types";

type DeadlineModalProps = {
  editor: DeadlineEditorState;
  isPending: boolean;
  onCancel: () => void;
  onClear: () => void;
  onSave: () => void;
  onValueChange: (value: string) => void;
};

export function DeadlineModal({ editor, isPending, onCancel, onClear, onSave, onValueChange }: DeadlineModalProps) {
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose: onCancel, disabled: isPending });
  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-card card deadline-modal dashboard-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <form noValidate onSubmit={(event) => { event.preventDefault(); onSave(); }}>
          <h3 id={titleId} className="deadline-modal-title">Дедлайн формы</h3>
          <p className="deadline-modal-subtitle">{editor.form.title}</p>
          <label className="deadline-field">
            <span>Дата и время окончания</span>
            <input type="datetime-local" value={editor.value} onChange={(event) => onValueChange(event.target.value)} />
          </label>
          <p className="deadline-modal-hint">При наступлении дедлайна форма автоматически закроется, а дедлайн снимется.</p>
          <div className="deadline-modal-actions">
            <button type="button" className="deadline-action-cancel-button" onClick={onCancel} disabled={isPending}>
              Отмена
            </button>
            <button
              type="button"
              className="deadline-clear-button deadline-action-clear-button"
              onClick={onClear}
              disabled={isPending || !editor.form.deadline_at}
            >
              {isPending && <InlineSpinner />}
              Снять дедлайн
            </button>
            <button type="submit" className="deadline-action-save-button" disabled={isPending}>
              {isPending && <InlineSpinner />}
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
