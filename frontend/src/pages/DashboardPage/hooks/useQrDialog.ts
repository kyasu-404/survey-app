import { useMemo, useState } from "react";
import { routes } from "../../../app/routes";
import { useToast } from "../../../app/providers/ToastProvider";
import { getSurveyDisplayTitle } from "../../../entities/survey/model/surveyModel";
import type { SurveyFormSummary } from "../../../entities/survey/types";
import { copyTextToClipboard } from "../../../shared/lib/browser";
import { getErrorMessage } from "../../../shared/lib/error";
import { createQrPngDataUrl, createQrSvg, downloadDataUrl, svgToDataUrl } from "../../../shared/lib/qrCode";
import type { QrDialogState } from "../types";

export function useQrDialog() {
  const { showToast } = useToast();
  const [qrDialog, setQrDialog] = useState<QrDialogState | null>(null);
  const [qrGeneratingFormId, setQrGeneratingFormId] = useState<string | null>(null);
  const [qrDownloadFormat, setQrDownloadFormat] = useState<"png" | "svg" | null>(null);
  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  const getFormLink = (formId: string) => `${appOrigin}${routes.survey(formId)}`;

  const handleCopyLink = async (formId: string) => {
    try {
      const copied = await copyTextToClipboard(getFormLink(formId));
      if (!copied) {
        showToast("Автокопирование недоступно. Скопируйте ссылку вручную.", "warning");
        return;
      }
      showToast("Ссылка скопирована", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скопировать ссылку"), "error");
    }
  };

  const handleOpenQrCode = async (form: SurveyFormSummary) => {
    const link = getFormLink(form.id);
    const title = getSurveyDisplayTitle(form);

    setQrGeneratingFormId(form.id);

    try {
      const svg = await createQrSvg(link);
      setQrDialog({
        fileName: `form-${form.id}-qr`,
        link,
        previewDataUrl: svgToDataUrl(svg),
        title,
      });
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось сгенерировать QR-код"), "error");
    } finally {
      setQrGeneratingFormId(null);
    }
  };

  const handleDownloadQr = async (format: "png" | "svg") => {
    if (!qrDialog) {
      return;
    }

    setQrDownloadFormat(format);

    try {
      if (format === "png") {
        const pngDataUrl = await createQrPngDataUrl(qrDialog.link);
        downloadDataUrl(pngDataUrl, `${qrDialog.fileName}.png`);
      } else {
        const svg = await createQrSvg(qrDialog.link);
        downloadDataUrl(svgToDataUrl(svg), `${qrDialog.fileName}.svg`);
      }
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось скачать QR-код"), "error");
    } finally {
      setQrDownloadFormat(null);
    }
  };

  return {
    handleCopyLink,
    handleDownloadQr,
    handleOpenQrCode,
    qrDialog,
    qrDownloadFormat,
    qrGeneratingFormId,
    setQrDialog,
  };
}
