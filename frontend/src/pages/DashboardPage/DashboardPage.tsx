import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import {
  changeFormStatus,
  cloneForm,
  getForms,
  removeForm,
  renameForm,
  setFormDeadline,
} from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle } from "../../entities/survey/model/surveyModel";
import type { SurveyForm } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";

type DashboardPageProps = {
  viewMode: "mine" | "all";
};

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

export default function DashboardPage({ viewMode }: DashboardPageProps) {
  const { user, loading: isAuthLoading } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [formToDelete, setFormToDelete] = useState<SurveyForm | null>(null);
  const [openedMenuFormId, setOpenedMenuFormId] = useState<string | null>(null);

  const [responsesByFormId, setResponsesByFormId] = useState<ResponsesMap>({});
  const [loadingResponsesByFormId, setLoadingResponsesByFormId] = useState<LoadingResponsesMap>({});
  const [openedResponsesByFormId, setOpenedResponsesByFormId] = useState<Record<string, boolean>>({});

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const formsQueryKey = useMemo(
    () => ["forms", { dateFrom, dateTo, viewMode, userId: user?.id ?? null }],
    [dateFrom, dateTo, user?.id, viewMode],
  );

  const {
    data: forms = [],
    isLoading: isFormsLoading,
    isFetching: isFormsFetching,
    error: formsError,
    refetch: reloadForms,
  } = useQuery({
    queryKey: formsQueryKey,
    queryFn: () =>
      getForms({
        dateFrom,
        dateTo,
        authorId: viewMode === "mine" ? user?.id : undefined,
      }),
    enabled: !isAuthLoading && (viewMode === "all" || Boolean(user?.id)),
    retry: 1,
  });

  const filteredForms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return forms;
    }

    return forms.filter((form) => {
      const title = form.title?.toLowerCase() ?? "";
      const authorName = form.author_name?.toLowerCase() ?? "";
      const authorEmail = form.author_email?.toLowerCase() ?? "";
      const authorId = form.author_id?.toLowerCase() ?? "";

      return (
        title.includes(normalizedSearch) ||
        authorName.includes(normalizedSearch) ||
        authorEmail.includes(normalizedSearch) ||
        authorId.includes(normalizedSearch)
      );
    });
  }, [forms, search]);

  const formsCountText = useMemo(() => `Всего форм: ${filteredForms.length}`, [filteredForms.length]);
  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  useEffect(() => {
    if (formsError) {
      showToast(getErrorMessage(formsError, "Не удалось загрузить формы"), "error");
    }
  }, [formsError, showToast]);

  const invalidateForms = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forms"] });
    await reloadForms();
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameForm(id, title),
  });
  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeForm(id),
  });
  const duplicateMutation = useMutation({
    mutationFn: ({ form, authorId }: { form: SurveyForm; authorId: string }) => cloneForm(form, authorId),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => changeFormStatus(id, isPublic),
  });
  const deadlineMutation = useMutation({
    mutationFn: ({ id, deadlineAt }: { id: string; deadlineAt: string | null }) => setFormDeadline(id, deadlineAt),
  });

  const runAction = async (
    action: () => Promise<void>,
    options: { successMessage: string; errorMessage: string; shouldReloadForms?: boolean },
  ) => {
    setIsActionLoading(true);

    try {
      await action();
      if (options.shouldReloadForms ?? true) {
        await invalidateForms();
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

    await runAction(() => renameMutation.mutateAsync({ id: form.id, title: newTitle.trim() }), {
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

    await runAction(() => removeMutation.mutateAsync({ id: deletingForm.id }), {
      successMessage: "Форма удалена",
      errorMessage: "Не удалось удалить форму",
    });
  };

  const handleDuplicate = async (form: SurveyForm) => {
    if (!user?.id) {
      showToast("Для дублирования формы нужно войти в систему", "error");
      return;
    }

    await runAction(() => duplicateMutation.mutateAsync({ form, authorId: user.id }), {
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось дублировать форму",
    });
  };

  const handleEditForm = (form: SurveyForm) => {
    navigate(routes.builderEdit(form.id));
  };

  const handleToggleFormStatus = async (form: SurveyForm) => {
    const nextStatus = !form.is_public;
    await runAction(() => statusMutation.mutateAsync({ id: form.id, isPublic: nextStatus }), {
      successMessage: nextStatus ? "Форма активирована" : "Форма закрыта",
      errorMessage: "Не удалось изменить статус формы",
    });
  };

  const handleSetDeadline = async (form: SurveyForm) => {
    const currentDeadline = form.deadline_at ? new Date(form.deadline_at).toISOString().slice(0, 16) : "";
    const input = window.prompt(
      "Укажите дедлайн в формате YYYY-MM-DDTHH:mm или оставьте пустым для снятия ограничения",
      currentDeadline,
    );

    if (input === null) {
      return;
    }

    const normalizedInput = input.trim();
    if (!normalizedInput) {
      await runAction(() => deadlineMutation.mutateAsync({ id: form.id, deadlineAt: null }), {
        successMessage: "Дедлайн снят",
        errorMessage: "Не удалось обновить дедлайн",
      });
      return;
    }

    const parsedDate = new Date(normalizedInput);
    if (Number.isNaN(parsedDate.getTime())) {
      showToast("Некорректный формат даты дедлайна", "error");
      return;
    }

    await runAction(() => deadlineMutation.mutateAsync({ id: form.id, deadlineAt: parsedDate.toISOString() }), {
      successMessage: "Дедлайн установлен",
      errorMessage: "Не удалось обновить дедлайн",
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
        <h2 style={{ marginTop: 4 }}>Список форм</h2>
        <p style={{ color: "var(--text-muted)" }}>{formsCountText}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <input
            className="dashboard-search-input"
            placeholder="Поиск по названию и автору"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <button onClick={() => void reloadForms()} disabled={isFormsLoading || isActionLoading || isFormsFetching}>
            {isFormsLoading || isFormsFetching ? "Загрузка..." : "Обновить"}
          </button>
        </div>

        {(isFormsLoading || isActionLoading || isFormsFetching) && <p style={{ color: "#334155" }}>Загрузка...</p>}

        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {filteredForms.map((form) => {
            const link = `${appOrigin}${routes.survey(form.id)}`;
            const authorLabel = form.author_name || form.author_email || form.author_id;
            const responsesCount = form.responses_count ?? 0;
            const isResponsesOpen = openedResponsesByFormId[form.id];
            const isResponsesLoading = loadingResponsesByFormId[form.id];
            const responses = responsesByFormId[form.id] ?? [];
            const rows = formatResponsesForTable(responses);
            const headers = rows[0] ? Object.keys(rows[0]) : [];
            const isFormActive = form.is_public;
            const deadlineLabel = form.deadline_at
              ? new Date(form.deadline_at).toLocaleString("ru-RU")
              : "Не установлен";

            return (
              <div key={form.id} className="dashboard-form-card">
                <div className="form-control-buttons">
                  <button onClick={() => void handleSetDeadline(form)} disabled={isActionLoading}>
                    Установить дедлайн
                  </button>
                  <button
                    className={`form-status-button ${isFormActive ? "form-status-active" : "form-status-closed"}`}
                    onClick={() => void handleToggleFormStatus(form)}
                    disabled={isActionLoading}
                  >
                    {isFormActive ? "Активна" : "Закрыта"}
                  </button>
                  <div className="form-menu">
                    <button
                      className="form-menu-trigger"
                      onClick={() => setOpenedMenuFormId((prev) => (prev === form.id ? null : form.id))}
                      disabled={isActionLoading}
                      aria-label="Действия с формой"
                    >
                      ⋯
                    </button>
                    {openedMenuFormId === form.id && (
                      <div className="form-menu-dropdown">
                        <button
                          className="form-menu-item"
                          onClick={() => {
                            setOpenedMenuFormId(null);
                            void handleRename(form);
                          }}
                          disabled={isActionLoading}
                        >
                          Переименовать
                        </button>
                        <button
                          className="form-menu-item"
                          onClick={() => {
                            setOpenedMenuFormId(null);
                            handleEditForm(form);
                          }}
                          disabled={isActionLoading}
                        >
                          Редактировать
                        </button>
                        <button
                          className="form-menu-item"
                          onClick={() => {
                            setOpenedMenuFormId(null);
                            void handleDuplicate(form);
                          }}
                          disabled={isActionLoading}
                        >
                          Дублировать
                        </button>
                        <button
                          className="form-menu-item form-menu-item-danger"
                          onClick={() => {
                            setOpenedMenuFormId(null);
                            void handleDelete(form);
                          }}
                          disabled={isActionLoading}
                        >
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <strong>{getSurveyDisplayTitle(form)}</strong>
                <div className="form-meta-line">
                  <span>Дата: {new Date(form.created_at).toLocaleString("ru-RU")}</span>
                  <span>Автор: {authorLabel}</span>
                  <span>Ответов: {responsesCount}</span>
                  <span>Дедлайн: {deadlineLabel}</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link
                    className="button-link"
                    to={routes.survey(form.id)}
                    onClick={(event) => {
                      if (!isFormActive) {
                        event.preventDefault();
                        showToast("Ссылка закрыта: форма неактивна", "info");
                      }
                    }}
                  >
                    Открыть
                  </Link>
                  <button onClick={() => handleCopyLink(link)} disabled={!isFormActive}>
                    Скопировать ссылку
                  </button>
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
                            {rows.map((row, index) => {
                              const rowId = responses[index]?.id ?? `${form.id}-${index}`;
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
