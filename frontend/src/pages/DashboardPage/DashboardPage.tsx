import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import { cloneForm, getForms, removeForm, renameForm } from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
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
  const [formToDelete, setFormToDelete] = useState<SurveyForm | null>(null);

  const [responsesByFormId, setResponsesByFormId] = useState<ResponsesMap>({});
  const [loadingResponsesByFormId, setLoadingResponsesByFormId] = useState<LoadingResponsesMap>({});
  const [openedResponsesByFormId, setOpenedResponsesByFormId] = useState<Record<string, boolean>>({});

  const lastLoadedFilterKeyRef = useRef<string | null>(null);
  const inFlightLoadRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const filterKey = `${search}|${dateFrom}|${dateTo}`;

  const loadForms = useCallback(async (force = false) => {
    if (!force) {
      if (inFlightLoadRef.current?.key === filterKey) {
        return inFlightLoadRef.current.promise;
      }

      if (lastLoadedFilterKeyRef.current === filterKey) {
        return;
      }
    }

    const requestPromise = (async () => {
      setIsFormsLoading(true);

      try {
        const nextForms = await getForms({ search, dateFrom, dateTo });
        setForms(nextForms);
        lastLoadedFilterKeyRef.current = filterKey;
      } catch (error) {
        console.error(error);
        showToast(getErrorMessage(error, "Не удалось загрузить формы"), "error");
      } finally {
        setIsFormsLoading(false);
        if (inFlightLoadRef.current?.key === filterKey) {
          inFlightLoadRef.current = null;
        }
      }
    })();

    inFlightLoadRef.current = { key: filterKey, promise: requestPromise };

    return requestPromise;
  }, [dateFrom, dateTo, filterKey, search, showToast]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  const formsCountText = useMemo(() => `Всего форм: ${forms.length}`, [forms.length]);
  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  const runAction = async (
    action: () => Promise<void>,
    options: { successMessage: string; errorMessage: string; shouldReloadForms?: boolean },
  ) => {
    setIsActionLoading(true);

    try {
      await action();
      if (options.shouldReloadForms ?? true) {
        await loadForms(true);
      }

      showToast(options.successMessage, "success");
    } catch (error) {
      console.error(error);
      showToast(getErrorMessage(error, options.errorMessage), "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      const copied = await copyTextToClipboard(link);

      if (!copied) {
        showToast("Автокопирование недоступно. Скопируйте ссылку вручную.", "info");
        return;
      }

      showToast("Ссылка скопирована", "success");
    } catch (error) {
      console.error("Не удалось скопировать ссылку", error);
      showToast(getErrorMessage(error, "Не удалось скопировать ссылку"), "error");
    }
  };

  const handleRename = async (form: SurveyForm) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) return;

    await runAction(() => renameForm(form.id, newTitle.trim()), {
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось переименовать форму",
    });
  };

  const handleDelete = async (form: SurveyForm) => {
    setFormToDelete(form);
  };

  const confirmDelete = async () => {
    if (!formToDelete) {
      return;
    }

    const deletingForm = formToDelete;
    setFormToDelete(null);

    await runAction(() => removeForm(deletingForm.id), {
      successMessage: "Форма удалена",
      errorMessage: "Не удалось удалить форму",
    });
  };

  const handleDuplicate = async (form: SurveyForm) => {
    if (!user?.id) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(() => cloneForm(form, user.id), {
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось дублировать форму",
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
      showToast(getErrorMessage(error, "Не удалось загрузить ответы"), "error");
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
          <button onClick={() => loadForms(true)} disabled={isFormsLoading || isActionLoading}>
            {isFormsLoading ? "Загрузка..." : "Обновить"}
          </button>
        </div>

        {(isFormsLoading || isActionLoading) && <p style={{ color: "#334155" }}>Загрузка...</p>}

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {forms.map((form) => {
            const link = `${appOrigin}${routes.survey(form.id)}`;
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

      {formToDelete && (
        <div className="modal-backdrop">
          <div className="modal-card card">
            <h3 style={{ marginTop: 0 }}>Удаление формы</h3>
            <p>Удалить форму «{formToDelete.title}»? Это действие нельзя отменить.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setFormToDelete(null)} disabled={isActionLoading}>Отмена</button>
              <button onClick={() => void confirmDelete()} disabled={isActionLoading}>Удалить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
