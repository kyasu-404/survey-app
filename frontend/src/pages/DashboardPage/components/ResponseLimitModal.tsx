import { InlineSpinner } from "../../../shared/ui/InlineSpinner";
import type { ResponseLimitEditorState } from "../types";

type ResponseLimitModalProps = {
  editor: ResponseLimitEditorState;
  isPending: boolean;
  onCancel: () => void;
  onClear: () => void;
  onSave: () => void;
  onValueChange: (value: string) => void;
};

export function ResponseLimitModal({ editor, isPending, onCancel, onClear, onSave, onValueChange }: ResponseLimitModalProps) {
  const responsesCount = editor.form.responses_count ?? 0;
  const minimumLimit = Math.max(1, responsesCount);

  return (
    <div className="modal-backdrop">
      <div className="modal-card card deadline-modal dashboard-settings-modal" role="dialog" aria-modal="true" aria-label="Ограничение ответов">
        <h3 className="deadline-modal-title">Ограничение ответов</h3>
        <p className="deadline-modal-subtitle">{editor.form.title}</p>
        <label className="deadline-field">
          <span>Максимум ответов</span>
          <input
            type="number"
            min={minimumLimit}
            step={1}
            inputMode="numeric"
            value={editor.value}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </label>
        <p className="deadline-modal-hint">
          Когда лимит будет достигнут, форма закроется. Уже получено ответов: {responsesCount}.
        </p>
        <div className="deadline-modal-actions">
          <button type="button" className="deadline-action-cancel-button" onClick={onCancel} disabled={isPending}>
            Отмена
          </button>
          <button
            type="button"
            className="deadline-clear-button deadline-action-clear-button"
            onClick={onClear}
            disabled={isPending || !editor.form.max_responses}
          >
            {isPending && <InlineSpinner />}
            Снять ограничение
          </button>
          <button type="button" className="deadline-action-save-button" onClick={onSave} disabled={isPending}>
            {isPending && <InlineSpinner />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
