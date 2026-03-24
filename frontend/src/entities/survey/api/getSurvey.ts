import { supabase } from "../../../shared/api/supabase";

export const getSurvey = async (id: string) => {
  const { data, error } = await supabase.from("forms").select("*").eq("id", id).single();

  if (error) throw error;

  return data;
};
