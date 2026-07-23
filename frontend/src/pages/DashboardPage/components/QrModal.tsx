import type { QrDialogState } from "../types";

type QrModalProps = {
  downloadFormat: "png" | "svg" | null;
  onClose: () => void;
  onDownload: (format: "png" | "svg") => void;
  qrDialog: QrDialogState;
};

export function QrModal({ downloadFormat, onClose, onDownload, qrDialog }: QrModalProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card dashboard-qr-modal" role="dialog" aria-modal="true" aria-label={`QR-код формы ${qrDialog.title}`}>
        <div className="dashboard-qr-modal-header">
          <div>
            <h3 className="dashboard-qr-modal-title">QR-код формы</h3>
            <p className="dashboard-qr-modal-copy">{qrDialog.title}</p>
          </div>
          <button type="button" className="dashboard-qr-close-button" aria-label="Закрыть QR-код" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dashboard-qr-download-actions">
          <button type="button" className="app-button" onClick={() => onDownload("png")} disabled={downloadFormat !== null}>
            PNG
          </button>
          <button type="button" className="app-button" onClick={() => onDownload("svg")} disabled={downloadFormat !== null}>
            SVG
          </button>
        </div>
        <div className="dashboard-qr-preview">
          <img src={qrDialog.previewDataUrl} alt={`QR-код формы ${qrDialog.title}`} />
        </div>
        <p className="dashboard-qr-link">{qrDialog.link}</p>
      </div>
    </div>
  );
}
