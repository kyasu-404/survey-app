import { supabase } from "../shared/api/supabase";

export async function login(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export async function register(email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
  });
}
