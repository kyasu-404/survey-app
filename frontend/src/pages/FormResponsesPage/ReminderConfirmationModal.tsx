import { lazy, Suspense, useState } from "react";
import { useModalSurface } from "../../shared/ui/useModalSurface";
const MailComposer = lazy(() => import("../../features/mail-composer/MailComposer").then(module => ({ default: module.MailComposer })));

export function ReminderConfirmationModal({ formId, onCancel }: { formId: string; onCancel: () => void }) {
  const dialog = useModalSurface();
  const [busy, setBusy] = useState(false);
  return <dialog ref={dialog} className="modal-card card dashboard-share-modal" aria-label="Подготовить напоминания"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dashboard-qr-modal-header">
      <h2 className="dashboard-qr-modal-title">Напомнить о заполнении</h2>
      <button type="button" className="dashboard-qr-close-button" aria-label="Закрыть напоминания" disabled={busy} onClick={onCancel}>×</button>
    </div>
    <div className="dashboard-share-panel"><Suspense fallback={<p role="status">Загрузка редактора…</p>}><MailComposer formId={formId} kind="reminder" onBusyChange={setBusy} /></Suspense></div>
  </dialog>;
}
