import type { SurveySchema } from "../../entities/survey/types";
import { SurveyFormRenderer } from "../../features/render-form/SurveyFormRenderer";
import { useState } from 'react'
import { submitResponse } from '@/entities/response/api/submitResponse'
import { Question } from '@/entities/survey/types'

export function SurveyRenderer({ schema, formId }: { schema: SurveySchema; formId: string }) {
  return <SurveyFormRenderer schema={schema} formId={formId} />;
}

export const SurveyRenderer = ({ survey }) => {
  const [answers, setAnswers] = useState<Record<string, any>>({})

  const handleChange = (id: string, value: any) => {
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  const handleSubmit = async () => {
    await submitResponse(survey.id, answers)
    alert('Отправлено')
  }

  return (
    <div>
      <h1>{survey.title}</h1>

      {survey.schema.map((q: Question) => {
        switch (q.type) {
          case 'text':
            return (
              <div key={q.id}>
                <label>{q.label}</label>
                <input
                  onChange={e => handleChange(q.id, e.target.value)}
                />
              </div>
            )

          case 'radio':
            return (
              <div key={q.id}>
                <label>{q.label}</label>
                {q.options.map(opt => (
                  <div key={opt}>
                    <input
                      type="radio"
                      name={q.id}
                      onChange={() => handleChange(q.id, opt)}
                    />
                    {opt}
                  </div>
                ))}
              </div>
            )
        }
      })}

      <button onClick={handleSubmit}>Отправить</button>
    </div>
  )
}
