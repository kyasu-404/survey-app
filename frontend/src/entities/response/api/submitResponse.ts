import { supabase } from '@/shared/api/supabase'

export const submitResponse = async (surveyId: string, answers: any) => {
  const { error } = await supabase.from('responses').insert({
    survey_id: surveyId,
    answers,
  })

  if (error) throw error
}
