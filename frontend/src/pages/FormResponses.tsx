import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToExcel } from "../utils/export";

export default function FormResponses({ formId }) {
  const [responses, setResponses] = useState([]);
  const [columnsMap, setColumnsMap] = useState({});
  const [selectedColumns, setSelectedColumns] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    // 🔹 получаем форму
    const { data: form } = await supabase
      .from("forms")
      .select("*")
      .eq("id", formId)
      .single();

    // 🔥 строим map name → title
    const map = {};
    form.schema.pages?.forEach(page => {
      page.elements?.forEach(el => {
        map[el.name] = el.title;
      });
    });

    setColumnsMap(map);

    // 🔹 получаем ответы
    const { data: responsesData } = await supabase
      .from("responses")
      .select("*")
      .eq("form_id", formId);

    setResponses(responsesData);
  }

  const allColumns = Object.keys(columnsMap);

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
        const title = columnsMap[col]; // 👈 название
        row[title] = r.data?.[col];
      });

      return row;
    });

    exportToExcel(filtered);
  }

  return (
    <div>
      <h2>Ответы</h2>

      <h4>Выбери колонки:</h4>
      {allColumns.map(col => (
        <label key={col} style={{ display: "block" }}>
          <input
            type="checkbox"
            onChange={() => toggleColumn(col)}
          />
          {columnsMap[col]} {/* 👈 название */}
        </label>
      ))}

      <button onClick={handleExport}>
        Экспорт в XLS
      </button>
    </div>
  );
}
