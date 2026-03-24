import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useUser() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);

      if (data.user) {
        supabase
          .from("profiles")
          .select("*")
          .eq("id", data.user.id)
          .single()
          .then(({ data }) => setProfile(data));
      }
    });
  }, []);

  return { user, profile };
}
