import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function FormsList() {
  const [forms, setForms] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("forms")
      .select("*")
      .ilike("title", `%${search}%`); // 🔥 поиск

    setForms(data);
  }

  function handleSearch(e) {
    setSearch(e.target.value);
  }

  useEffect(() => {
    const timeout = setTimeout(load, 300); // debounce
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div>
      <h2>Формы</h2>

      <input
        placeholder="Поиск по названию..."
        value={search}
        onChange={handleSearch}
      />

      {forms.map(f => (
        <div key={f.id}>
          <b>{f.title}</b>
        </div>
      ))}
    </div>
  );
}
