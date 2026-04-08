import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useToast } from "../../app/providers/ToastProvider";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { getFormById } from "../../entities/survey/api/surveysApi";
import type {
  SurveyForm,
  SurveyPageSchema,
  SurveyQuestion,
  SurveySchema,
} from "../../entities/survey/types";
import refreshIcon from "../../img/refresh.png";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";

type ResponsesTableRow = {
  [key: string]: string;
};

function getQuestionMeta(schema: SurveySchema) {
  const questions = schema.pages.flatMap((page: SurveyPageSchema) => page.elements ?? []);
  const choiceMap = new Map<string, Map<string, string>>();
  const titleMap = new Map<string, string>();

  questions.forEach((question: SurveyQuestion) => {
    if (question.name) {
      titleMap.set(question.name, question.title ?? question.name);
    }

    if (!Array.isArray(question.choices) || !question.name) {
      return;
    }

    const questionChoiceMap = new Map<string, string>();
    question.choices.forEach((choice) => {
      if (typeof choice === "string") {
        questionChoiceMap.set(choice, choice);
        return;
      }

      const value = String(choice.value ?? choice.text ?? "");
      const text = String(choice.text ?? choice.value ?? "");
      if (value) {
        questionChoiceMap.set(value, text);
      }
    });

    if (questionChoiceMap.size > 0) {
      choiceMap.set(question.name, questionChoiceMap);
    }
  });

  return { choiceMap, titleMap };
}

function formatAnswerValue(questionName: string, value: unknown, choiceMap: Map<string, Map<string, string>>) {
  const questionChoices = choiceMap.get(questionName);

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" && questionChoices?.has(item)) {
          return questionChoices.get(item) ?? item;
        }

        if (item && typeof item === "object" && "name" in item && typeof item.name === "string") {
          return item.name;
        }

        return String(item ?? "");
      })
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "string" && questionChoices?.has(value)) {
    return questionChoices.get(value) ?? value;
  }

  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "object") {
    if ("name" in value && typeof value.name === "string") {
      return value.name;
    }

    return JSON.stringify(value);
  }

  return String(value);
}

function formatResponsesForTable(responses: SurveyResponse[], schema: SurveySchema): ResponsesTableRow[] {
  const { choiceMap, titleMap } = getQuestionMeta(schema);

  return responses.map((response) => {
    const base: ResponsesTableRow = {
      "Дата ответа": new Date(response.created_at).toLocaleString("ru-RU"),
    };

    Object.entries(response.data).forEach(([key, value]) => {
      base[titleMap.get(key) ?? key] = formatAnswerValue(key, value, choiceMap);
    });

    return base;
  });
}

export default function FormResponsesPage() {
  const { id } = useParams();
  const { showToast } = useToast();

  const formQuery = useQuery({
    queryKey: ["form", id],
    queryFn: async () => {
      if (!id) {
        return null;
      }

      return getFormById(id);
    },
    enabled: Boolean(id),
    retry: 1,
  });

  const responsesQuery = useQuery({
    queryKey: ["form-responses", id],
    queryFn: async () => {
      if (!id) {
        return [];
      }

      return getResponsesByForm(id);
    },
    enabled: Boolean(id),
    retry: 1,
  });

  const rows = useMemo(
    () => (formQuery.data ? formatResponsesForTable(responsesQuery.data ?? [], formQuery.data.schema) : []),
    [formQuery.data, responsesQuery.data],
  );

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const isLoading = formQuery.isLoading || responsesQuery.isLoading;
  const combinedError = formQuery.error ?? responsesQuery.error;

  const handleExport = () => {
    if (!rows.length) {
      showToast("Нет данных для выгрузки", "info");
      return;
    }

    const formTitle = (formQuery.data as SurveyForm | null)?.title ?? "форма";
    exportToExcel(rows, `ответы-${formTitle}`);
    showToast("Ответы выгружены в XLSX", "success");
  };

  if (!id) {
    return <p>Форма не найдена.</p>;
  }

  return (
    <div className="dashboard-page">
      <div className="card responses-page-card">
        <div className="responses-page-header">
          <div>
            <h1 className="responses-page-title">{formQuery.data?.title ?? "Ответы формы"}</h1>
          </div>
          <div className="responses-page-toolbar">
            <button type="button" onClick={handleExport} disabled={isLoading}>
              Выгрузить в XLSX
            </button>
            <button
              type="button"
              className="dashboard-refresh-button"
              onClick={() => {
                void formQuery.refetch();
                void responsesQuery.refetch();
              }}
              disabled={isLoading}
            >
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>Обновить</span>
            </button>
          </div>
        </div>

        {isLoading && <p className="dashboard-loading-text">Загрузка...</p>}
        {!isLoading && combinedError && (
          <p style={{ color: "#b91c1c" }}>{getErrorMessage(combinedError, "Не удалось загрузить ответы")}</p>
        )}

        {!isLoading && !combinedError && !rows.length && (
          <div className="dashboard-empty-state responses-page-empty">
            <h4>Ответов пока нет</h4>
            <p>Новые ответы появятся здесь автоматически после отправки формы.</p>
          </div>
        )}

        {!isLoading && !combinedError && !!rows.length && (
          <div className="responses-page-table-shell">
            <table className="responses-table">
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const rowId = responsesQuery.data?.[index]?.id ?? `${id}-${index}`;
                  return (
                    <tr key={rowId}>
                      {headers.map((header, columnIndex) => (
                        <td key={`${rowId}-${header}-${columnIndex}`}>{row[header]}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
