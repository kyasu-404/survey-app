import { supabase } from "../../../shared/api/supabase";
import { runRequest } from "../../../shared/api/request";

export const submitResponse = async (formId: string, data: Record<string, unknown>) => {
  const { error } = await runRequest(
    "responses.submitLegacy",
    () =>
      supabase.from("responses").insert({
        form_id: formId,
        data,
      }),
    { context: { formId } },
  );

  if (error) throw error;
};
