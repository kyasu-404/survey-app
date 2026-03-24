import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToExcel } from "../utils/export";

export default function FormResponses({ formId }) {
  const [responses, setResponses] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("responses")
      .select("*")
      .eq("form_id", formId);

    setResponses(data);
  }

  // 🔥 получаем все ключи из data
  const allColumns = responses.length
    ? Object.keys(responses[0].data || {})
    : [];

  function toggleColumn(col) {
    setSelectedColumns(prev =>
      prev.includes(col)
        ? prev.filter(c => c !== col)
        : [...prev, col]
    );
  }

  function handleExport() {
    const filtered = responses.map(r => {
      const row = {};
      selectedColumns.forEach(col => {
        row[col] = r.data?.[col];
      });
      return row;
    });

    exportToExcel(filtered);
  }

  return (
    <div>
      <h2>Ответы</h2>

      {/* 🔹 выбор колонок */}
      <div>
        <h4>Выбери колонки:</h4>
        {allColumns.map(col => (
          <label key={col} style={{ display: "block" }}>
            <input
              type="checkbox"
              onChange={() => toggleColumn(col)}
            />
            {col}
          </label>
        ))}
      </div>

      <button onClick={handleExport}>
        Экспорт в XLS
      </button>

      <pre>{JSON.stringify(responses, null, 2)}</pre>
    </div>
  );
}
