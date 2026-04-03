import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import { routes } from "../../app/routes";
import { getResponsesByForm } from "../../entities/response/api";
import type { SurveyResponse } from "../../entities/response/types";
import copyIcon from "../../img/copy.png";
import refreshIcon from "../../img/refresh.png";
import {
  changeFormStatus,
  cloneForm,
  getForms,
  removeForm,
  renameForm,
  setFormDeadline,
} from "../../entities/survey/api/surveysApi";
import { getSurveyDisplayTitle, isTemplateForm } from "../../entities/survey/model/surveyModel";
import type { SurveyForm, SurveyPageSchema, SurveyQuestion, SurveySchema } from "../../entities/survey/types";
import { copyTextToClipboard } from "../../shared/lib/browser";
import { getErrorMessage } from "../../shared/lib/error";
import { exportToExcel } from "../../shared/lib/export";

type DashboardPageProps = {
  viewMode: "mine" | "all";
};

type ResponsesTableRow = {
  [key: string]: string;
};

type FormResponsesSectionProps = {
  form: SurveyForm;
  formId: string;
  isOpen: boolean;
};

type DeadlineEditorState = {
  form: SurveyForm;
  value: string;
};

function isFormAcceptingResponses(form: Pick<SurveyForm, "is_public" | "deadline_at" | "form_type">) {
  if (isTemplateForm(form)) {
    return false;
  }

  if (!form.is_public) {
    return false;
  }

  if (!form.deadline_at) {
    return true;
  }

  return new Date(form.deadline_at).getTime() > Date.now();
}

function getQuestionChoiceMap(schema: SurveySchema) {
  const questions = schema.pages.flatMap((page: SurveyPageSchema) => page.elements ?? []);
  const choicesMap = new Map<string, Map<string, string>>();

  questions.forEach((question: SurveyQuestion) => {
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
      choicesMap.set(question.name, questionChoiceMap);
    }
  });

  return choicesMap;
}

function formatAnswerValue(questionName: string, value: unknown, choiceMap: Map<string, Map<string, string>>): string {
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
  const choiceMap = getQuestionChoiceMap(schema);

  return responses.map((response) => {
    const base: ResponsesTableRow = {
      "Дата ответа": new Date(response.created_at).toLocaleString("ru-RU"),
    };

    Object.entries(response.data).forEach(([key, value]) => {
      base[key] = formatAnswerValue(key, value, choiceMap);
    });

    return base;
  });
}

function formatDateTimeLocalValue(dateTime: string | null) {
  if (!dateTime) {
    return "";
  }

  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offsetInMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetInMs).toISOString().slice(0, 16);
}

function FormResponsesSection({ form, formId, isOpen }: FormResponsesSectionProps) {
  const responsesQuery = useQuery({
    queryKey: ["form-responses", formId],
    queryFn: () => getResponsesByForm(formId),
    enabled: isOpen,
    retry: 1,
  });

  if (!isOpen) {
    return null;
  }

  const responses = responsesQuery.data ?? [];
  const rows = formatResponsesForTable(responses, form.schema);
  const headers = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="dashboard-responses">
      {responsesQuery.isLoading && <p>Загрузка ответов...</p>}
      {!responsesQuery.isLoading && responsesQuery.error && (
        <p style={{ color: "#b91c1c" }}>{getErrorMessage(responsesQuery.error, "Не удалось загрузить ответы")}</p>
      )}
      {!responsesQuery.isLoading && !responsesQuery.error && !rows.length && <p>Ответов пока нет.</p>}
      {!responsesQuery.isLoading && !responsesQuery.error && !!rows.length && (
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
                const rowId = responses[index]?.id ?? `${formId}-${index}`;
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
  );
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
  const [openedResponsesByFormId, setOpenedResponsesByFormId] = useState<Record<string, boolean>>({});
  const [deadlineEditor, setDeadlineEditor] = useState<DeadlineEditorState | null>(null);
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

  const visibleForms = useMemo(
    () => (viewMode === "all" ? forms.filter((form) => !isTemplateForm(form)) : forms),
    [forms, viewMode],
  );

  const filteredForms = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return visibleForms;
    }

    return visibleForms.filter((form) => {
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
  }, [search, visibleForms]);

  const appOrigin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);
  const isInitialFormsLoading = isFormsLoading && forms.length === 0;
  const activeFormsCount = useMemo(() => filteredForms.filter((form) => form.is_public).length, [filteredForms]);
  const formsWithDeadlineCount = useMemo(() => filteredForms.filter((form) => Boolean(form.deadline_at)).length, [filteredForms]);

  useEffect(() => {
    if (formsError) {
      showToast(getErrorMessage(formsError, "Не удалось загрузить формы"), "error");
    }
  }, [formsError, showToast]);

  useEffect(() => {
    if (!openedMenuFormId) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".form-menu")) {
        return;
      }

      setOpenedMenuFormId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenedMenuFormId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openedMenuFormId]);

  const invalidateForms = async () => {
    await queryClient.invalidateQueries({ queryKey: ["forms"] });
    await queryClient.refetchQueries({ queryKey: ["forms"], type: "active" });
  };

  const invalidateFormDetails = async (formId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["form", formId] }),
      queryClient.invalidateQueries({ queryKey: ["survey-form", formId] }),
      queryClient.refetchQueries({ queryKey: ["form", formId], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["survey-form", formId], type: "active" }),
    ]);
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
    options: { successMessage: string; errorMessage: string; shouldReloadForms?: boolean; affectedFormId?: string },
  ) => {
    setIsActionLoading(true);
    try {
      await action();
      if (options.affectedFormId) {
        await invalidateFormDetails(options.affectedFormId);
      }
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
      showToast(getErrorMessage(error, "Не удалось скопировать ссылку"), "error");
    }
  };

  const handleRename = async (form: SurveyForm) => {
    const newTitle = window.prompt("Введите новое название формы", form.title);
    if (!newTitle || !newTitle.trim() || newTitle === form.title) {
      return;
    }

    await runAction(() => renameMutation.mutateAsync({ id: form.id, title: newTitle.trim() }), {
      successMessage: "Форма сохранена",
      errorMessage: "Не удалось переименовать форму",
      affectedFormId: form.id,
    });
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
      affectedFormId: deletingForm.id,
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

  const handleToggleFormStatus = async (form: SurveyForm) => {
    const nextStatus = !form.is_public;
    await runAction(() => statusMutation.mutateAsync({ id: form.id, isPublic: nextStatus }), {
      successMessage: nextStatus ? "Форма активирована" : "Форма закрыта",
      errorMessage: "Не удалось изменить статус формы",
      affectedFormId: form.id,
    });
  };

  const handleExportResponses = async (form: SurveyForm) => {
    try {
      const responses = await queryClient.fetchQuery({
        queryKey: ["form-responses", form.id],
        queryFn: () => getResponsesByForm(form.id),
      });
      const tableRows = formatResponsesForTable(responses, form.schema);
      if (!tableRows.length) {
        showToast("Нет данных для выгрузки", "info");
        return;
      }
      exportToExcel(tableRows, `ответы-${form.title}`);
      showToast("Ответы выгружены в XLS", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось выгрузить ответы"), "error");
    }
  };

  return (
    <div className="dashboard-page dashboard-shell">
      <section className="card dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="dashboard-kicker">{viewMode === "all" ? "Общий каталог" : "Личное пространство"}</span>
        </div>
        <div className="dashboard-stats">
          <div className="dashboard-stat-card">
            <span>Всего форм</span>
            <strong>{filteredForms.length}</strong>
          </div>
          <div className="dashboard-stat-card">
            <span>Активных</span>
            <strong>{activeFormsCount}</strong>
          </div>
          <div className="dashboard-stat-card">
            <span>С дедлайном</span>
            <strong>{formsWithDeadlineCount}</strong>
          </div>
        </div>
      </section>

      <div className="card dashboard-main-card">
        <div className="dashboard-toolbar">
          <input
            className="dashboard-search-input"
            placeholder="Поиск по названию и автору"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="dashboard-filter-group">
            <label className="dashboard-filter-field">
              <span>Дата с</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="dashboard-filter-field">
              <span>Дата по</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <button className="dashboard-refresh-button" onClick={() => void reloadForms()} disabled={isFormsLoading || isActionLoading || isFormsFetching}>
              <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
              <span>{isFormsFetching ? "Обновляется..." : "Обновить"}</span>
            </button>
          </div>
        </div>

        {isInitialFormsLoading && <p className="dashboard-loading-text">Загрузка...</p>}
        {!isInitialFormsLoading && filteredForms.length === 0 && (
          <div className="dashboard-empty-state">
            <h4>Форм пока нет</h4>
            <p>Попробуйте изменить фильтры или создайте новую форму в конструкторе.</p>
          </div>
        )}

        <div className="dashboard-forms-grid">
          {filteredForms.map((form) => {
            const link = `${appOrigin}${routes.survey(form.id)}`;
            const authorLabel = form.author_name || form.author_email || form.author_id;
            const responsesCount = form.responses_count ?? 0;
            const isResponsesOpen = openedResponsesByFormId[form.id];
            const isFormActive = form.is_public;
            const isOwnForm = form.author_id === user?.id;
            const isTemplate = isTemplateForm(form);
            const isFormOpenForResponses = isFormAcceptingResponses(form);
            const deadlineLabel = form.deadline_at ? new Date(form.deadline_at).toLocaleString("ru-RU") : "Не установлен";

            return (
              <div key={form.id} className={`dashboard-form-card ${openedMenuFormId === form.id ? "dashboard-form-card-menu-open" : ""}`.trim()}>
                <div className="dashboard-form-top">
                  <div className="dashboard-form-mainline">
                    <div className="dashboard-form-status-row">
                      <span
                        className={`dashboard-status-pill ${isTemplate ? "dashboard-status-pill-template" : isFormActive ? "dashboard-status-pill-active" : "dashboard-status-pill-closed"}`}
                      >
                        {isTemplate ? "Шаблон" : isFormActive ? "Активна" : "Закрыта"}
                      </span>
                      {isOwnForm && <span className="dashboard-owner-badge">Моя форма</span>}
                    </div>
                    <strong className="dashboard-form-title">{getSurveyDisplayTitle(form)}</strong>
                  </div>

                  {isOwnForm && !isTemplate && (
                    <div className="dashboard-form-controls">
                      <button className="dashboard-secondary-button" onClick={() => setDeadlineEditor({ form, value: formatDateTimeLocalValue(form.deadline_at) })} disabled={isActionLoading}>
                        {form.deadline_at ? "Изменить дедлайн" : "Установить дедлайн"}
                      </button>
                      <button className={`form-status-button ${isFormActive ? "form-status-active" : "form-status-closed"}`} onClick={() => void handleToggleFormStatus(form)} disabled={isActionLoading}>
                        {isFormActive ? "Активна" : "Закрыта"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="dashboard-form-meta-grid">
                  <span className="dashboard-meta-pill">Дата: {new Date(form.created_at).toLocaleString("ru-RU")}</span>
                  {!isTemplate && <span className="dashboard-meta-pill">Автор: {authorLabel}</span>}
                  {!isTemplate && (
                    <span className={`dashboard-meta-pill ${responsesCount > 0 ? "dashboard-meta-pill-responses-positive" : ""}`.trim()}>
                      Ответов: {responsesCount}
                    </span>
                  )}
                  {!isTemplate && <span className="dashboard-meta-pill">Дедлайн: {deadlineLabel}</span>}
                </div>

                <div className="dashboard-form-actions">
                  {isTemplate ? (
                    <div className="form-menu">
                      <button
                        className="form-menu-trigger"
                        onClick={() => setOpenedMenuFormId((prev) => (prev === form.id ? null : form.id))}
                        disabled={isActionLoading}
                        aria-label="Действия с шаблоном"
                        aria-expanded={openedMenuFormId === form.id}
                      >
                        ...
                      </button>
                      {openedMenuFormId === form.id && (
                        <div className="form-menu-dropdown">
                          <button className="form-menu-item" onClick={() => { setOpenedMenuFormId(null); void handleRename(form); }} disabled={isActionLoading}>Переименовать</button>
                          <button className="form-menu-item form-menu-item-danger" onClick={() => { setOpenedMenuFormId(null); setFormToDelete(form); }} disabled={isActionLoading}>Удалить</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <Link
                        className="button-link"
                        to={routes.survey(form.id)}
                        onClick={(event) => {
                          if (!isFormOpenForResponses) {
                            event.preventDefault();
                            showToast(
                              form.deadline_at && new Date(form.deadline_at).getTime() <= Date.now()
                                ? "Ссылка недоступна: дедлайн формы уже истёк"
                                : "Ссылка закрыта: форма неактивна",
                              "info",
                            );
                          }
                        }}
                      >
                        Открыть
                      </Link>
                      <button onClick={() => handleCopyLink(link)} disabled={!isFormOpenForResponses}>Скопировать ссылку</button>
                      <button onClick={() => setOpenedResponsesByFormId((prev) => ({ ...prev, [form.id]: !prev[form.id] }))}>
                        {isResponsesOpen ? "Скрыть ответы" : "Показать ответы"}
                      </button>
                      <button onClick={() => void handleExportResponses(form)}>XLS</button>
                      {isOwnForm ? (
                        <div className="form-menu">
                          <button
                            className="form-menu-trigger"
                            onClick={() => setOpenedMenuFormId((prev) => (prev === form.id ? null : form.id))}
                            disabled={isActionLoading}
                            aria-label="Действия с формой"
                            aria-expanded={openedMenuFormId === form.id}
                          >
                            ...
                          </button>
                          {openedMenuFormId === form.id && (
                            <div className="form-menu-dropdown">
                              <button className="form-menu-item" onClick={() => { setOpenedMenuFormId(null); void handleRename(form); }} disabled={isActionLoading}>Переименовать</button>
                              <button className="form-menu-item" onClick={() => { setOpenedMenuFormId(null); navigate(routes.builderEdit(form.id)); }} disabled={isActionLoading}>Редактировать</button>
                              <button className="form-menu-item" onClick={() => { setOpenedMenuFormId(null); void handleDuplicate(form); }} disabled={isActionLoading}>Дублировать</button>
                              <button className="form-menu-item form-menu-item-danger" onClick={() => { setOpenedMenuFormId(null); setFormToDelete(form); }} disabled={isActionLoading}>Удалить</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button className="icon-action-button" onClick={() => void handleDuplicate(form)} disabled={isActionLoading} aria-label="Дублировать" title="Дублировать">
                          <img src={copyIcon} alt="" aria-hidden="true" className="toolbar-icon" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {!isTemplate && <FormResponsesSection form={form} formId={form.id} isOpen={Boolean(isResponsesOpen)} />}
              </div>
            );
          })}
        </div>
      </div>

      {deadlineEditor && (
        <div className="modal-backdrop">
          <div className="modal-card card deadline-modal">
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Дедлайн формы</h3>
            <p className="deadline-modal-subtitle">{deadlineEditor.form.title}</p>
            <label className="deadline-field">
              <span>Дата и время окончания</span>
              <input type="datetime-local" value={deadlineEditor.value} onChange={(e) => setDeadlineEditor((prev) => (prev ? { ...prev, value: e.target.value } : prev))} />
            </label>
            <p className="deadline-modal-hint">После наступления дедлайна форма останется видимой, но новые ответы отправить не получится.</p>
            <div className="deadline-modal-actions">
              <button onClick={() => setDeadlineEditor(null)} disabled={isActionLoading}>Отмена</button>
              <button className="deadline-clear-button" onClick={() => deadlineEditor && runAction(() => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: null }), { successMessage: "Дедлайн снят", errorMessage: "Не удалось обновить дедлайн", affectedFormId: deadlineEditor.form.id }).finally(() => setDeadlineEditor(null))} disabled={isActionLoading}>Снять дедлайн</button>
              <button
                onClick={() => {
                  if (!deadlineEditor) {
                    return;
                  }
                  const normalizedInput = deadlineEditor.value.trim();
                  if (!normalizedInput) {
                    showToast("Выберите дату и время или снимите дедлайн", "error");
                    return;
                  }
                  const parsedDate = new Date(normalizedInput);
                  if (Number.isNaN(parsedDate.getTime())) {
                    showToast("Некорректный формат даты дедлайна", "error");
                    return;
                  }
                  void runAction(() => deadlineMutation.mutateAsync({ id: deadlineEditor.form.id, deadlineAt: parsedDate.toISOString() }), {
                    successMessage: "Дедлайн установлен",
                    errorMessage: "Не удалось обновить дедлайн",
                    affectedFormId: deadlineEditor.form.id,
                  }).finally(() => setDeadlineEditor(null));
                }}
                disabled={isActionLoading}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

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
