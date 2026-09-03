export function ReminderConfirmationModal({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop reminder-confirmation-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPending && onCancel()}>
      <div className="modal-card card reminder-confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="reminder-confirmation-title">
        <h2 id="reminder-confirmation-title">Отправить напоминания?</h2>
        <p>Отправить на почту напоминания организациям, которые не предоставили ответ?</p>
        <div className="reminder-confirmation-actions">
          <button type="button" className="app-button" onClick={onCancel} disabled={isPending}>Отмена</button>
          <button type="button" className="button-primary" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Формирование…" : "Да"}
          </button>
        </div>
      </div>
    </div>
  );
}
