import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getForms } from "../../entities/survey/api/surveysApi";
import type { SurveyForm } from "../../entities/survey/types";

export default function DashboardPage() {
  const [forms, setForms] = useState<SurveyForm[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    getForms({ search, dateFrom, dateTo }).then(setForms).catch(console.error);
  }, [search, dateFrom, dateTo]);

  const formsCountText = useMemo(() => `Всего форм: ${forms.length}`, [forms.length]);

  return (
    <div>
      <h2>Дашборд форм</h2>
      <p>{formsCountText}</p>

      <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {forms.map((form) => {
          const link = `${window.location.origin}/survey/${form.id}`;
          return (
            <div key={form.id} style={{ border: "1px solid #eee", padding: 12, borderRadius: 8 }}>
              <strong>{form.title}</strong>
              <p>{new Date(form.created_at).toLocaleString()}</p>
              <Link to={`/survey/${form.id}`}>Открыть</Link>
              <button onClick={() => navigator.clipboard.writeText(link)}>Скопировать ссылку</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
