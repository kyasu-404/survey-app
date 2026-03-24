import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getForms } from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { routes } from "../../app/routes";

export default function DashboardPage() {
  const [forms, setForms] = useState<SurveyForm[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [copiedFormId, setCopiedFormId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    getForms({ search, dateFrom, dateTo }).then(setForms).catch(console.error);
  }, [search, dateFrom, dateTo]);

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

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          background: "#fff"
        }}
      >
        <h2>Дашборд форм</h2>
        <p>{formsCountText}</p>

        <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {forms.map((form) => {
            const link = `${window.location.origin}${routes.survey(form.id)}`;
            return (
              <div key={form.id} style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <p>{new Date(form.created_at).toLocaleString()}</p>
                <Link to={routes.survey(form.id)}>Открыть</Link>
                <button onClick={() => handleCopyLink(form.id, link)}>
                  {copiedFormId === form.id ? "Скопировано" : "Скопировать ссылку"}
                </button>
              </div>
            );
          })}
        </div>

        {copyError && <p style={{ color: "#dc2626" }}>{copyError}</p>}
      </div>
    </div>
  );
}
