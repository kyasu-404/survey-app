import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAuthCacheGuard } from "../../app/providers/authCache";
import { useToast } from "../../app/providers/ToastProvider";
import { Skeleton } from "../../shared/ui/Skeleton";
import { getNotificationPreferences, saveNotificationPreferences } from "./api";
import { notificationPreferencesKey, preferenceCategories, type PreferenceCategory } from "./model";

export function NotificationPreferences({ userId, onSaved }: { userId: string; onSaved?: () => void }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<PreferenceCategory[] | null>(null);
  const preferences = useQuery({
    queryKey: notificationPreferencesKey(userId),
    queryFn: ({ signal }) => getNotificationPreferences(userId, signal),
  });
  const muted = draft ?? preferences.data ?? [];
  const dirty = draft && Object.keys(preferenceCategories).some(key =>
    muted.includes(key as PreferenceCategory) !== preferences.data?.includes(key as PreferenceCategory));
  const save = useMutation({
    mutationFn: saveNotificationPreferences,
    onMutate: () => createAuthCacheGuard(queryClient),
    onSuccess: (_, values, currentUser) => {
      if (!currentUser?.()) return;
      queryClient.setQueryData(notificationPreferencesKey(userId), values);
      setDraft(null);
      showToast("Настройки сохранены", "success");
    },
    onError: () => showToast("Не удалось сохранить настройки", "error"),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (dirty && !save.isPending) save.mutate(muted, { onSuccess: onSaved });
  }
  if (preferences.isPending) return <Skeleton className="activity-skeleton" />;
  if (preferences.isError) return <div role="alert" className="activity-state">
    <p>Не удалось загрузить настройки уведомлений.</p>
    <button type="button" className="app-button" onClick={() => void preferences.refetch()}>Повторить</button>
  </div>;
  return <form onSubmit={submit} className="activity-preferences">
    <fieldset aria-labelledby={headingId} disabled={save.isPending}>
      <h2 id={headingId}>Уведомления в приложении</h2>
      <p className="activity-muted">Выберите события, о которых хотите узнавать. Объявления администрации видны всегда.</p>
      {Object.entries(preferenceCategories).map(([id, label]) => {
        const category = id as PreferenceCategory;
        return <label key={id} className="activity-checkbox">
          <input type="checkbox" checked={!muted.includes(category)} onChange={(event) =>
            setDraft(event.target.checked ? muted.filter(item => item !== category) : [...muted, category])} />
          {label}
        </label>;
      })}
    </fieldset>
    <button type="submit" className="button-primary" disabled={!dirty || save.isPending}>
      {save.isPending ? "Сохранение…" : "Сохранить"}
    </button>
  </form>;
}
