import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../app/providers/AuthProvider";
import { useToast } from "../../app/providers/ToastProvider";
import {
  createOrganization,
  deleteAllOrganizations,
  deleteOrganization,
  getOrganizations,
  importOrganizations,
  updateOrganization,
} from "../../entities/organization/api";
import {
  getOrganizationTypeLabel,
  normalizeOrganizationInput,
  ORGANIZATION_TYPE_OPTIONS,
  validateOrganizationInput,
} from "../../entities/organization/model";
import type {
  EducationOrganization,
  EducationOrganizationInput,
  OrganizationType,
} from "../../entities/organization/types";
import { exportOrganizationsXlsx, parseOrganizationsXlsx } from "../../entities/organization/xlsx";
import downloadIcon from "../../img/Download.svg";
import uploadIcon from "../../img/Upload.svg";
import deleteIcon from "../../img/delete.svg";
import editIcon from "../../img/edit.svg";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";

type OrganizationFilter = "all" | OrganizationType;

const EMPTY_ORGANIZATION: EducationOrganizationInput = {
  organization_type: "school",
  number: "",
  alias: "",
  email: "",
};

export default function OrganizationsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<OrganizationFilter>("all");
  const [editingOrganization, setEditingOrganization] = useState<EducationOrganization | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [draft, setDraft] = useState<EducationOrganizationInput>(EMPTY_ORGANIZATION);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const canManage = profile?.role === "admin";
  const organizationsQuery = useQuery({
    queryKey: ["education-organizations"],
    queryFn: ({ signal }) => getOrganizations(undefined, signal),
    staleTime: 30_000,
  });
  const organizations = organizationsQuery.data ?? [];
  const filteredOrganizations = useMemo(
    () => filter === "all"
      ? organizations
      : organizations.filter((organization) => organization.organization_type === filter),
    [filter, organizations],
  );

  const openCreateModal = () => {
    setEditingOrganization(null);
    setDraft(EMPTY_ORGANIZATION);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (organization: EducationOrganization) => {
    setEditingOrganization(organization);
    setDraft({
      organization_type: organization.organization_type,
      number: organization.number,
      alias: organization.alias,
      email: organization.email,
    });
    setIsCreateModalOpen(false);
  };

  const closeModal = () => {
    if (!isSaving) {
      setEditingOrganization(null);
      setIsCreateModalOpen(false);
    }
  };

  const handleSave = async () => {
    if (!canManage) return;
    const normalized = normalizeOrganizationInput(draft);
    const validationError = validateOrganizationInput(normalized);
    if (validationError) {
      showToast(validationError, "warning");
      return;
    }

    setIsSaving(true);
    try {
      if (editingOrganization) {
        await updateOrganization(editingOrganization.id, normalized);
        showToast("Организация обновлена", "success");
      } else {
        await createOrganization(normalized);
        showToast("Организация добавлена", "success");
      }
      setEditingOrganization(null);
      setIsCreateModalOpen(false);
      await organizationsQuery.refetch();
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось сохранить организацию"), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (organization: EducationOrganization) => {
    if (!canManage || !window.confirm(`Удалить организацию «${organization.alias}»?`)) return;
    try {
      await deleteOrganization(organization.id);
      await organizationsQuery.refetch();
      showToast("Организация удалена", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось удалить организацию"), "error");
    }
  };

  const handleDeleteAll = async () => {
    if (!canManage || organizations.length === 0) return;
    if (!window.confirm(`Удалить все организации (${organizations.length})? Это действие нельзя отменить.`)) return;
    setIsDeletingAll(true);
    try {
      await deleteAllOrganizations();
      await organizationsQuery.refetch();
      showToast("Справочник очищен", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось очистить справочник"), "error");
    } finally {
      setIsDeletingAll(false);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file || !canManage) return;
    setIsImporting(true);
    try {
      const inputs = await parseOrganizationsXlsx(file);
      await importOrganizations(inputs);
      await organizationsQuery.refetch();
      showToast(`Импортировано организаций: ${inputs.length}`, "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось импортировать XLSX"), "error");
    } finally {
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const isModalOpen = isCreateModalOpen || Boolean(editingOrganization);

  return (
    <div className="dashboard-page">
      <div className="card organizations-page-card">
        <div className="organizations-page-header">
          <div>
            <h1>Справочник ОУ</h1>
            <p>Организации для полей форм и контроля сдачи ответов.</p>
          </div>
          <div className="organizations-toolbar">
            {canManage && (
              <button type="button" className="responses-export-button" onClick={openCreateModal}>
                Добавить +
              </button>
            )}
            <button
              type="button"
              className="responses-export-button organizations-file-button"
              onClick={() => importInputRef.current?.click()}
              disabled={!canManage || isImporting}
              title={!canManage ? "Импорт доступен администратору" : undefined}
            >
              {isImporting && <InlineSpinner />}
              Импорт XLSX
              <img src={uploadIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => void handleImportFile(event.target.files?.[0])}
            />
            <button
              type="button"
              className="responses-export-button organizations-file-button"
              onClick={() => void exportOrganizationsXlsx(filteredOrganizations)}
              disabled={filteredOrganizations.length === 0}
            >
              Экспорт XLSX
              <img src={downloadIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
            <button
              type="button"
              className="responses-export-button organizations-delete-all-button"
              onClick={() => void handleDeleteAll()}
              disabled={!canManage || organizations.length === 0 || isDeletingAll}
              title={!canManage ? "Удаление доступно администратору" : undefined}
            >
              {isDeletingAll ? "Удаление…" : "Удалить все"}
              <img src={deleteIcon} alt="" aria-hidden="true" className="toolbar-icon" />
            </button>
          </div>
        </div>

        <div className="organizations-type-switcher" role="tablist" aria-label="Типы образовательных учреждений">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            Все
          </button>
          {ORGANIZATION_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={filter === option.value ? "active" : ""}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {organizationsQuery.isLoading && (
          <div className="organizations-table-skeleton" aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="organizations-skeleton-row" />)}
          </div>
        )}
        {organizationsQuery.error && (
          <p className="responses-page-error">{getErrorMessage(organizationsQuery.error, "Не удалось загрузить справочник")}</p>
        )}
        {!organizationsQuery.isLoading && !organizationsQuery.error && filteredOrganizations.length === 0 && (
          <div className="dashboard-empty-state">
            <h4>Организаций пока нет</h4>
            <p>Добавьте организацию вручную или импортируйте XLSX.</p>
          </div>
        )}
        {filteredOrganizations.length > 0 && (
          <div className="users-table-shell organizations-table-shell">
            <table className="responses-table organizations-table">
              <thead>
                <tr>
                  <th>Тип ОУ</th>
                  <th>Номер</th>
                  <th>Алиасы</th>
                  <th>Email</th>
                  {canManage && <th>Действия</th>}
                </tr>
              </thead>
              <tbody>
                {filteredOrganizations.map((organization) => (
                  <tr key={organization.id}>
                    <td>{getOrganizationTypeLabel(organization.organization_type, true)}</td>
                    <td>{organization.number ?? "—"}</td>
                    <td>{organization.alias}</td>
                    <td><a href={`mailto:${organization.email}`}>{organization.email}</a></td>
                    {canManage && (
                      <td>
                        <div className="organizations-row-actions">
                          <button type="button" className="organization-edit-button" onClick={() => openEditModal(organization)}>
                            Изменить
                            <img src={editIcon} alt="" aria-hidden="true" />
                          </button>
                          <button type="button" className="danger organization-delete-button" onClick={() => void handleDelete(organization)}>
                            Удалить
                            <img src={deleteIcon} alt="" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal-backdrop">
          <div className="modal-card card organization-edit-modal" role="dialog" aria-modal="true" aria-label={editingOrganization ? "Изменение организации" : "Добавление организации"}>
            <h3 className="users-modal-title">{editingOrganization ? "Изменить организацию" : "Добавить организацию"}</h3>
            <label>
              <span>Тип ОУ</span>
              <select
                value={draft.organization_type}
                onChange={(event) => {
                  const organizationType = event.target.value as OrganizationType;
                  setDraft((current) => ({
                    ...current,
                    organization_type: organizationType,
                    number: organizationType === "udod" ? null : current.number,
                  }));
                }}
              >
                {ORGANIZATION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.singularLabel}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Номер</span>
              <input
                value={draft.number ?? ""}
                disabled={draft.organization_type === "udod"}
                placeholder={draft.organization_type === "udod" ? "Для УДОД номер не используется" : "Например, 123"}
                onChange={(event) => setDraft((current) => ({ ...current, number: event.target.value }))}
              />
            </label>
            <label>
              <span>Алиас</span>
              <input
                value={draft.alias}
                placeholder="Например, ГБОУ"
                onChange={(event) => setDraft((current) => ({ ...current, alias: event.target.value }))}
              />
            </label>
            <label>
              <span>Email</span>
              <input
                type="email"
                value={draft.email}
                placeholder="school@example.ru"
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <div className="deadline-modal-actions">
              <button type="button" className="users-neutral-button" onClick={closeModal} disabled={isSaving}>Отмена</button>
              <button type="button" className="users-yellow-button" onClick={() => void handleSave()} disabled={isSaving}>
                {isSaving && <InlineSpinner />}
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
