import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { exportToExcel } from "../utils/export";

export default function FormResponses({ formId }) {
  const [responses, setResponses] = useState([]);

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

  function handleExport() {
    exportToExcel(responses);
  }

  return (
    <div>
      <h2>Ответы</h2>

      <button onClick={handleExport}>
        Экспорт в XLS
      </button>

      <pre>{JSON.stringify(responses, null, 2)}</pre>
    </div>
  );
}
