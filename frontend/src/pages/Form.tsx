import { useEffect, useState } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import { supabase } from "../lib/supabase";
import { useParams } from "react-router-dom";

export default function Form({ id }) {
  const { id } = useParams();
  const [survey, setSurvey] = useState(null);

  useEffect(() => {
    supabase.from("forms").select("*").eq("id", id).single()
      .then(({ data }) => {
        const model = new Model(data.schema);

        model.onComplete.add(async (sender) => {
          await supabase.from("responses").insert({
            form_id: id,
            data: sender.data
          });
        });

        setSurvey(model);
      });
  }, []);

  return survey && <Survey model={survey} />;
}
