import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { cloneForm, getForms, removeForm, renameForm } from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { exportToExcel } from "../../shared/lib/export";

type LoadingResponsesMap = Record<string, boolean>;
type ResponsesMap = Record<string, SurveyResponse[]>;

type ResponsesTableRow = {
  [key: string]: string;
};

function formatResponsesForTable(responses: SurveyResponse[]): ResponsesTableRow[] {
  return responses.map((response) => {
    const base: ResponsesTableRow = {
      "Дата ответа": new Date(response.created_at).toLocaleString("ru-RU"),
      "ID ответа": response.id,
    };

    Object.entries(response.data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        base[key] = value.join(", ");
        return;
      }

      if (value === null || typeof value === "undefined") {
        base[key] = "";
        return;
      }

      if (typeof value === "object") {
        base[key] = JSON.stringify(value);
        return;
      }

      base[key] = String(value);
    });

    return base;
  });
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [forms, setForms] = useState<SurveyForm[]>([]);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isFormsLoading, setIsFormsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const [responsesByFormId, setResponsesByFormId] = useState<ResponsesMap>({});
  const [loadingResponsesByFormId, setLoadingResponsesByFormId] = useState<LoadingResponsesMap>({});
  const [openedResponsesByFormId, setOpenedResponsesByFormId] = useState<Record<string, boolean>>({});

  const loadForms = useCallback(async () => {
    setIsFormsLoading(true);

    try {
      const nextForms = await getForms({ search, dateFrom, dateTo });
      setForms(nextForms);
    } catch (error) {
      console.error(error);
      showToast("Не удалось загрузить формы", "error");
    } finally {
      setIsFormsLoading(false);
    }
  }, [search, dateFrom, dateTo, showToast]);

  useEffect(() => {
    loadForms().catch((error) => {
      console.error(error);
      showToast("Не удалось загрузить формы", "error");
    });
  }, [loadForms, showToast]);

  const formsCountText = useMemo(() => `Всего форм: ${forms.length}`, [forms.length]);

  const handleCopyLink = async (link: string) => {
    if (!navigator.clipboard) {
      showToast("Копирование недоступно в этом браузере", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      showToast("Ссылка скопирована", "success");
    } catch (error) {
      console.error("Не удалось скопировать ссылку", error);
      showToast("Не удалось скопировать ссылку", "error");
    }
  };

  const runAction = async (action: () => Promise<void>) => {
    setIsActionLoading(true);
    try {
      await action();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRename = async (form: SurveyForm) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) return;

    await runAction(async () => {
      try {
        await renameForm(form.id, newTitle.trim());
        await loadForms();
        showToast("Форма сохранена", "success");
      } catch (error) {
        console.error(error);
        showToast("Не удалось переименовать форму", "error");
      }
    });
  };

  const handleDelete = async (form: SurveyForm) => {
    const shouldDelete = window.confirm(`Удалить форму \"${form.title}\"?`);
    if (!shouldDelete) return;

    await runAction(async () => {
      try {
        await removeForm(form.id);
        await loadForms();
        showToast("Форма удалена", "success");
      } catch (error) {
        console.error(error);
        showToast("Не удалось удалить форму", "error");
      }
    });
  };

  const handleDuplicate = async (form: SurveyForm) => {
    if (!user?.id) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(async () => {
      try {
        await cloneForm(form, user.id);
        await loadForms();
        showToast("Форма сохранена", "success");
      } catch (error) {
        console.error(error);
        showToast("Не удалось дублировать форму", "error");
      }
    });
  };

  const toggleResponses = async (formId: string) => {
    const isOpen = openedResponsesByFormId[formId];
    if (isOpen) {
      setOpenedResponsesByFormId((prev) => ({ ...prev, [formId]: false }));
      return;
    }

    setOpenedResponsesByFormId((prev) => ({ ...prev, [formId]: true }));

    if (responsesByFormId[formId]) {
      return;
    }

    setLoadingResponsesByFormId((prev) => ({ ...prev, [formId]: true }));

    try {
      const responses = await getResponsesByForm(formId);
      setResponsesByFormId((prev) => ({ ...prev, [formId]: responses }));
    } catch (error) {
      console.error(error);
      showToast("Не удалось загрузить ответы", "error");
    } finally {
      setLoadingResponsesByFormId((prev) => ({ ...prev, [formId]: false }));
    }
  };

  const handleExportResponses = (formId: string, formTitle: string) => {
    const responses = responsesByFormId[formId] ?? [];
    const tableRows = formatResponsesForTable(responses);

    if (!tableRows.length) {
      showToast("Нет данных для выгрузки", "info");
      return;
    }

    exportToExcel(tableRows, `ответы-${formTitle}`);
    showToast("Ответы выгружены в XLS", "success");
  };

  return (
    <div className="dashboard-page">
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ marginTop: 4 }}>Дашборд форм</h2>
        <p style={{ color: "#475569" }}>{formsCountText}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button onClick={() => loadForms()} disabled={isFormsLoading || isActionLoading}>
            {isFormsLoading ? "Загрузка..." : "Обновить"}
          </button>
        </div>

        {(isFormsLoading || isActionLoading) && <p style={{ color: "#334155" }}>Загрузка...</p>}

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {forms.map((form) => {
            const link = `${window.location.origin}${routes.survey(form.id)}`;
            const authorLabel = form.author_email || form.author_id;
            const responsesCount = form.responses_count ?? 0;
            const isResponsesOpen = openedResponsesByFormId[form.id];
            const isResponsesLoading = loadingResponsesByFormId[form.id];
            const responses = responsesByFormId[form.id] ?? [];
            const rows = formatResponsesForTable(responses);
            const headers = rows[0] ? Object.keys(rows[0]) : [];

            return (
              <div key={form.id} className="dashboard-form-card">
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <p style={{ color: "#64748b", marginBottom: 6 }}>{new Date(form.created_at).toLocaleString("ru-RU")}</p>
                <p style={{ color: "#475569", margin: "0 0 4px" }}>Автор: {authorLabel}</p>
                <p style={{ color: "#475569", margin: "0 0 10px" }}>Ответов: {responsesCount}</p>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link className="nav-link" to={routes.survey(form.id)}>
                    Открыть
                  </Link>
                  <button onClick={() => handleCopyLink(link)}>Скопировать ссылку</button>
                  <button onClick={() => handleRename(form)} disabled={isActionLoading}>Переименовать</button>
                  <button onClick={() => handleDuplicate(form)} disabled={isActionLoading}>Дублировать</button>
                  <button onClick={() => handleDelete(form)} disabled={isActionLoading}>Удалить</button>
                  <button onClick={() => toggleResponses(form.id)}>
                    {isResponsesOpen ? "Скрыть ответы" : "Показать ответы"}
                  </button>
                  <button onClick={() => handleExportResponses(form.id, form.title)}>Выгрузить XLS</button>
                </div>

                {isResponsesOpen && (
                  <div style={{ marginTop: 12 }}>
                    {isResponsesLoading && <p>Загрузка ответов...</p>}
                    {!isResponsesLoading && !rows.length && <p>Ответов пока нет.</p>}
                    {!isResponsesLoading && !!rows.length && (
                      <div style={{ overflowX: "auto" }}>
                        <table className="responses-table">
                          <thead>
                            <tr>
                              {headers.map((header) => (
                                <th key={header}>{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row, index) => (
                              <tr key={`${form.id}-${index}`}>
                                {headers.map((header) => (
                                  <td key={header}>{row[header]}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
