import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { routes } from "../../app/routes";
import { cloneForm, getForms, removeForm, renameForm } from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";

export default function DashboardPage() {
  const { user } = useAuth();
  const [forms, setForms] = useState<SurveyForm[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadForms = useCallback(async () => {
    const nextForms = await getForms({ search, dateFrom, dateTo });
    setForms(nextForms);
  }, [search, dateFrom, dateTo]);

  useEffect(() => {
    loadForms().catch((error) => {
      console.error(error);
      setActionError("Не удалось загрузить формы.");
    });
  }, [loadForms]);

  const formsCountText = useMemo(() => `Всего форм: ${forms.length}`, [forms.length]);

  const handleCopyLink = async (formId: string, link: string) => {
    if (!navigator.clipboard) {
      setCopyError("Копирование недоступно в этом браузере. Используйте HTTPS или скопируйте ссылку вручную.");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      setCopiedFormId(formId);
      setCopyError(null);

      window.setTimeout(() => {
        setCopiedFormId((previousValue) => (previousValue === formId ? null : previousValue));
      }, 2000);
    } catch (error) {
      console.error("Не удалось скопировать ссылку", error);
      setCopyError("Не удалось скопировать ссылку. Проверьте доступ к буферу обмена.");
    }
  };

  const handleRename = async (form: SurveyForm) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) return;

    try {
      await renameForm(form.id, newTitle.trim());
      await loadForms();
      setActionError(null);
    } catch (error) {
      console.error(error);
      setActionError("Не удалось переименовать форму.");
    }
  };

  const handleDelete = async (form: SurveyForm) => {
    const shouldDelete = window.confirm(`Удалить форму \"${form.title}\"?`);
    if (!shouldDelete) return;

    try {
      await removeForm(form.id);
      await loadForms();
      setActionError(null);
    } catch (error) {
      console.error(error);
      setActionError("Не удалось удалить форму.");
    }
  };

  const handleDuplicate = async (form: SurveyForm) => {
    if (!user?.id) {
      setActionError("Для дублирования формы нужно войти в систему.");
      return;
    }

    try {
      await cloneForm(form, user.id);
      await loadForms();
      setActionError(null);
    } catch (error) {
      console.error(error);
      setActionError("Не удалось дублировать форму.");
    }
  };

  return (
    <div className="dashboard-page">
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 4 }}>Дашборд форм</h2>
        <p style={{ color: "#475569" }}>{formsCountText}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {forms.map((form) => {
            const link = `${window.location.origin}${routes.survey(form.id)}`;
            const authorLabel = form.author_email || form.author_id;
            const responsesCount = form.responses_count ?? 0;

            return (
              <div
                key={form.id}
                style={{ border: "1px solid #e2e8f0", padding: 14, borderRadius: 12, background: "#f8fafc" }}
              >
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <p style={{ color: "#64748b", marginBottom: 6 }}>{new Date(form.created_at).toLocaleString()}</p>
                <p style={{ color: "#475569", margin: "0 0 4px" }}>Автор: {authorLabel}</p>
                <p style={{ color: "#475569", margin: "0 0 10px" }}>Ответов: {responsesCount}</p>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="nav-link" to={routes.survey(form.id)}>
                    Открыть
                  </Link>
                  <button onClick={() => handleCopyLink(form.id, link)}>
                    {copiedFormId === form.id ? "Скопировано" : "Скопировать ссылку"}
                  </button>
                  <button onClick={() => handleRename(form)}>Переименовать</button>
                  <button onClick={() => handleDuplicate(form)}>Дублировать</button>
                  <button onClick={() => handleDelete(form)}>Удалить</button>
                </div>
              </div>
            );
          })}
        </div>

        {copyError && <p style={{ color: "#dc2626" }}>{copyError}</p>}
        {actionError && <p style={{ color: "#dc2626" }}>{actionError}</p>}
      </div>
    </div>
  );
}
