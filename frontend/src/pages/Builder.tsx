import { SurveyCreator } from "survey-creator-react";
import { supabase } from "../lib/supabase";

export default function Builder() {
  const creator = new SurveyCreator({
    showLogicTab: true
  });

  creator.saveSurveyFunc = async (_, callback) => {
    const schema = creator.JSON;

  await supabase.from("forms").insert({
    title: "Новая форма",
    form_type: "anketa",
    form_reason: "plan",
    schema,
    author_id: (await supabase.auth.getUser()).data.user.id
  });

    callback(_, true);
  };

  return <SurveyCreator creator={creator} />;
}
