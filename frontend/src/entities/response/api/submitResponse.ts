import { supabase } from "../../../shared/api/supabase";

export const submitResponse = async (formId: string, data: Record<string, unknown>) => {
  const { error } = await supabase.from("responses").insert({
    form_id: formId,
    data,
  });

  if (error) throw error;
};
