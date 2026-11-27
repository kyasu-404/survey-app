import { getOfficeArchiveAuthorization, officeRequest } from "../../office/api";

export async function exportResponseFilesZip(formId: string, selected: { id: string; number: number }[] | undefined, signal: AbortSignal) {
  const authorization = await getOfficeArchiveAuthorization(signal);
  const { ticket } = await officeRequest<{ ticket: string | null }>(`/forms/${encodeURIComponent(formId)}/response-archive`, {
    method: "POST",
    headers: { Authorization: authorization },
    body: JSON.stringify({ selected }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
  });
  signal.throwIfAborted();
  if (!ticket) return false;

  const link = document.createElement("a");
  link.href = `/api/office/response-archives/${encodeURIComponent(ticket)}`;
  link.download = "";
  link.referrerPolicy = "no-referrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
