import { supabase } from "../lib/supabase";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    supabase.from("profiles").select("*")
      .then(({ data }) => setUsers(data));
  }, []);

  async function makeAdmin(id) {
    await supabase
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", id);
  }

  return (
    <div>
      {users.map(u => (
        <div key={u.id}>
          {u.email} - {u.role}
          <button onClick={() => makeAdmin(u.id)}>
            Сделать админом
          </button>
        </div>
      ))}
    </div>
  );
}
