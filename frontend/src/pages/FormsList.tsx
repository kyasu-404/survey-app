import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function FormsList() {
  const [forms, setForms] = useState([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    load();
  }, [search, dateFrom, dateTo]);

  function getLink(id) {
  return `${window.location.origin}/form/${id}`;
  }

  <button onClick={() => navigator.clipboard.writeText(getLink(f.id))}>
  Скопировать ссылку
  </button>
  
  async function load() {
    let query = supabase.from("forms").select("*");

    // 🔍 поиск
    if (search) {
      query = query.ilike("title", `%${search}%`);
    }

    // 📅 фильтр по дате
    if (dateFrom) {
      query = query.gte("created_at", dateFrom);
    }

    if (dateTo) {
      query = query.lte("created_at", dateTo);
    }

    const { data } = await query;

    setForms(data);
  }

  return (
    <div>
      <h2>Формы</h2>

      {/* 🔍 поиск */}
      <input
        placeholder="Поиск..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* 📅 фильтры */}
      <div>
        <label>
          С даты:
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </label>

        <label>
          По дату:
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </label>
      </div>

      {forms.map(f => (
        <div key={f.id}>
          <b>{f.title}</b> — {f.created_at}
        </div>
      ))}
    </div>
  );
}
