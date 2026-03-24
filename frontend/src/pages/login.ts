import { supabase } from "./supabase";

export async function login(email, password) {
  return supabase.auth.signInWithPassword({
    email,
    password
  });
}

export async function register(email, password) {
  return supabase.auth.signUp({
    email,
    password
  });
}
