import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { supabase } from "../lib/supabase";

export default function Form() {
  const { id } = useParams();
  const [survey, setSurvey] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("forms")
      .select("*")
      .eq("id", id)
      .single();

    const model = new Model(data.schema);

    model.onComplete.add(async (sender) => {
      await supabase.from("responses").insert({
        form_id: id,
        data: sender.data
      });
    });

    setSurvey(model);
  }

  return survey && <Survey model={survey} />;
}
