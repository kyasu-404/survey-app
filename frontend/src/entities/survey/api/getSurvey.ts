import { supabase } from "../../../shared/api/supabase";
import { runRequest } from "../../../shared/api/request";

export const getSurvey = async (id: string) => {
  const { data, error } = await runRequest(
    "survey.getById",
    () => supabase.from("forms").select("*").eq("id", id).single(),
    { context: { formId: id } },
  );

  if (error) throw error;

  return data;
};
