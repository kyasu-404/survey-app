import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../app/providers/AuthProvider";
import { routes } from "../../../app/routes";
import { useToast } from "../../../app/providers/ToastProvider";
import { getSurveyDisplayTitle } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { copyTextToClipboard } from "../../../shared/lib/browser";
import { getErrorMessage } from "../../../shared/lib/error";
import { createQrPngDataUrl, createQrSvg, downloadDataUrl, svgToDataUrl } from "../../../shared/lib/qrCode";
import { SectionTabs } from "../../../shared/ui/SectionTabs";
import { PersonalLinksPanel } from "./PersonalLinksPanel";
import downloadIcon from "../../../img/Download.svg";

const MailComposer = lazy(() => import("../../../features/mail-composer/MailComposer").then(module => ({ default: module.MailComposer })));

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function ShareFormModal({ form, onClose }: { form: SurveyFormSummary; onClose: () => void }) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isAuthor = Boolean(user && form.author_id === user.id);
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"link" | "qr" | "embed" | "mail">("link");
  const [mailVisited, setMailVisited] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const close = () => { if (!mailBusy) onClose(); };
  const openComposer = () => { setMailVisited(true); setTab("mail"); };
  const [preview, setPreview] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrAttempt, setQrAttempt] = useState(0);
  const [downloadFormat, setDownloadFormat] = useState<"png" | "svg" | null>(null);
  const title = getSurveyDisplayTitle(form);
  const link = `${window.location.origin}${routes.survey(form.id)}`;
  const embedCode = `<iframe\n  src="${escapeAttribute(link)}"\n  title="${escapeAttribute(title)}"\n  width="100%"\n  height="700"\n  style="border: 0;"\n  loading="lazy"\n></iframe>`;

  useEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (tab !== "qr" || preview) return;
    let cancelled = false;
    setQrError(null);
    void createQrSvg(link).then(svg => {
      if (!cancelled) setPreview(svgToDataUrl(svg));
    }).catch(error => {
      if (!cancelled) setQrError(getErrorMessage(error, "Не удалось сгенерировать QR-код"));
    });
    return () => { cancelled = true; };
  }, [tab, link, preview, qrAttempt]);

  const copy = async (value: string, success: string) => {
    try {
      const copied = await copyTextToClipboard(value);
      showToast(copied ? success : "Автокопирование недоступно. Выделите и скопируйте текст вручную.", copied ? "success" : "warning");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скопировать. Выделите и скопируйте текст вручную."), "error");
    }
  };

  const download = async (format: "png" | "svg") => {
    if (downloadFormat) return;
    setDownloadFormat(format);
    try {
      const dataUrl = format === "png" ? await createQrPngDataUrl(link) : svgToDataUrl(await createQrSvg(link));
      downloadDataUrl(dataUrl, `form-${form.id}-qr.${format}`);
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скачать QR-код"), "error");
    } finally {
      setDownloadFormat(null);
    }
  };

  return (
    <dialog ref={dialog} className={`modal-card card dashboard-share-modal${isAuthor ? "" : " dashboard-share-basic"}`} aria-label={`Поделиться формой ${title}`}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      }}>
      <div className="dashboard-qr-modal-header">
        <div>
          <h2 className="dashboard-qr-modal-title">Поделиться формой</h2>
          <p className="dashboard-qr-modal-copy">{title}</p>
        </div>
        <button type="button" className="dashboard-qr-close-button" aria-label="Закрыть окно поделиться" disabled={mailBusy} onClick={close}>×</button>
      </div>
      <SectionTabs id="form-share" label="Способ поделиться" tabs={[
        { value: "link", label: "Ссылка" }, { value: "qr", label: "QR-код" }, { value: "embed", label: "Код для сайта" }, ...(isAuthor ? [{ value: "mail" as const, label: "Рассылка" }] : []),
      ]} value={tab} onChange={next => { if (mailBusy) return; setTab(next); if (next === "mail") setMailVisited(true); }} />
      {!form.is_public && <p className="dashboard-share-notice">Форма закрыта. Откройте её для приёма ответов, чтобы посетители могли её заполнить.</p>}
      <div className="dashboard-share-panel" role="tabpanel" id="form-share-panel-link" aria-labelledby="form-share-tab-link" hidden={tab !== "link"}>
        <label className="dashboard-share-field">
          <span>Ссылка на форму</span>
          <input readOnly value={link} onFocus={event => event.currentTarget.select()} />
        </label>
        <button type="button" className="button-primary" onClick={() => void copy(link, "Ссылка скопирована")}>Копировать ссылку</button>
        {isAuthor && <PersonalLinksPanel formId={form.id} title={title} isPublic={form.is_public} onCompose={openComposer} />}
      </div>
      <div className="dashboard-share-panel" role="tabpanel" id="form-share-panel-qr" aria-labelledby="form-share-tab-qr" hidden={tab !== "qr"}>
        {qrError ? <div role="alert"><p>{qrError}</p><button type="button" className="app-button" onClick={() => setQrAttempt(attempt => attempt + 1)}>Повторить</button></div>
          : preview ? <>
            <div className="dashboard-qr-preview"><img src={preview} alt={`QR-код формы ${title}`} /></div>
            <div className="dashboard-qr-download-actions">
              <button type="button" className="app-button dashboard-qr-download-button" disabled={downloadFormat !== null} onClick={() => void download("png")}><span>PNG</span><img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" /></button>
              <button type="button" className="app-button dashboard-qr-download-button" disabled={downloadFormat !== null} onClick={() => void download("svg")}><span>SVG</span><img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" /></button>
            </div>
          </> : <p role="status">Создание QR-кода…</p>}
      </div>
      <div className="dashboard-share-panel" role="tabpanel" id="form-share-panel-embed" aria-labelledby="form-share-tab-embed" hidden={tab !== "embed"}>
        <p>Вставьте этот код в HTML-блок вашего сайта. Форма займёт всю ширину блока; высоту можно изменить в параметре height.</p>
        <label className="dashboard-share-field">
          <span>Код для встраивания</span>
          <textarea readOnly value={embedCode} rows={9} spellCheck={false} onFocus={event => event.currentTarget.select()} />
        </label>
        <button type="button" className="button-primary" onClick={() => void copy(embedCode, "Код для сайта скопирован")}>Копировать код</button>
      </div>
      <div className="dashboard-share-panel" role="tabpanel" id="form-share-panel-mail" aria-labelledby="form-share-tab-mail" hidden={tab !== "mail"}>
        {isAuthor && mailVisited && <Suspense fallback={<p role="status">Загрузка редактора…</p>}><MailComposer formId={form.id} kind="invitation" onBusyChange={setMailBusy} /></Suspense>}
      </div>
    </dialog>
  );
}
