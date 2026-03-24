import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "http://localhost:8000",
  "YOUR_ANON_KEY"
);
