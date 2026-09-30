import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../../app/providers/ToastProvider";
import { getPersonalLinks, setPersonalLinks } from "../../../entities/personal-link/api";
import { getFormQueryKey } from "../../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../../shared/lib/error";

export function PersonalLinksPanel({ formId, title, isPublic, onCompose }: { formId: string; title: string; isPublic: boolean; onCompose: () => void }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["form-personal-links", formId];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => getPersonalLinks(formId, signal), retry: 1, refetchOnMount: "always" });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const state = query.data;
  const links = state?.links ?? [];
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await action(); }
    catch (error) { showToast(getErrorMessage(error, "Не удалось выполнить действие с персональными ссылками"), "error"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const toggle = () => run(async () => {
    const next = await setPersonalLinks(formId, !state?.enabled);
    queryClient.setQueryData(queryKey, next);
    await queryClient.invalidateQueries({ queryKey: getFormQueryKey(formId) });
    showToast(next.enabled ? `Персональные ссылки готовы: ${next.links.length}` : "Персональные ссылки отключены", "success");
  });
  const download = () => run(async () => {
    // Include newly added organizations without replacing previously issued tokens.
    const next = await setPersonalLinks(formId, true);
    queryClient.setQueryData(queryKey, next);
    if (!next.links.length) {
      showToast("Нет действующих организаций выбранных типов ОУ", "warning");
      return;
    }
    const { exportPersonalLinksXlsx } = await import("../../../entities/personal-link/xlsx");
    await exportPersonalLinksXlsx(formId, title, next.links);
  });
  return <section className="personal-links-panel" aria-label="Персональные ссылки">
    <div className="personal-links-heading">
      <span id="personal-links-label">Персональные ссылки</span>
      <button type="button" role="switch" aria-labelledby="personal-links-label" aria-describedby="personal-links-help"
        aria-checked={state?.enabled ?? false} disabled={!state || !state.canManage || (!state.available && !state.enabled) || busy}
        className={`settings-toggle${state?.enabled ? " settings-toggle-active" : ""}`} onClick={() => void toggle()}><span /></button>
    </div>
    <p id="personal-links-help">{query.isPending ? "Проверяем наличие вопроса «Организация»…"
      : !state?.available ? "Доступны, если в форме есть вопрос «Организация»."
      : !state.canManage ? "Управлять ссылками может только автор формы."
      : "Для каждой действующей организации выбранных типов ОУ будет создана ссылка с заполненным полем «Организация». Изменить его будет нельзя. Отключение переключателя приостановит действие выданных ссылок. Обычная ссылка на форму продолжит работать."}</p>
    {query.error && <div role="alert"><p>{getErrorMessage(query.error, "Не удалось загрузить персональные ссылки")}</p><button type="button" className="app-button" onClick={() => void query.refetch()}>Повторить</button></div>}
    {state?.enabled && state.available && state.canManage && <>
      <p role="status"><strong>Ссылок {links.length}</strong></p>
      <div className="personal-links-actions">
        <button type="button" className="app-button" disabled={busy} onClick={() => void download()}>Скачать XLSX</button>
        <button type="button" className="button-primary" disabled={busy || !isPublic} onClick={onCompose}>Подготовить рассылку</button>
      </div>
    </>}
  </section>;
}
