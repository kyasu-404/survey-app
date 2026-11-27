import { ModalHeading } from "../../shared/ui/ModalHeading";
import { Presence } from "../../shared/ui/Presence";
import { AnimatedTabs } from "../../shared/ui/AnimatedTabs";
import { useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Icon } from "../../shared/ui/Icon";
import { getErrorMessage } from "../../shared/lib/error";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";
import { useLegacyModalDialog } from "../../shared/ui/useLegacyModalDialog";

type OrganizationFilter = "all" | OrganizationType;

const EMPTY_ORGANIZATION: EducationOrganizationInput = {
  organization_type: "school",
  number: "",
  alias: "",
  email: "",
};

function OrganizationEditModal({
  draft,
  editingOrganization,
  isSaving,
  onClose,
  onSave,
  setDraft,
}: {
  draft: EducationOrganizationInput;
  editingOrganization: EducationOrganization | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => Promise<void>;
  setDraft: Dispatch<SetStateAction<EducationOrganizationInput>>;
}) {
  const titleId = useId();
  const dialogRef = useLegacyModalDialog({ onClose, disabled: isSaving });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isSaving && onClose()}>
      <div
        ref={dialogRef}
        className="modal-card card organization-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-label={editingOrganization ? "Изменение организации" : "Добавление организации"}
        tabIndex={-1}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!isSaving) void onSave();
          }}
        >
          <ModalHeading onClose={onClose} disabled={isSaving}>
            <h3 id={titleId} className="users-modal-title">{editingOrganization ? "Изменить организацию" : "Добавить организацию"}</h3>
          </ModalHeading>
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
            <button type="button" className="users-neutral-button" onClick={onClose} disabled={isSaving}>Отмена</button>
            <button type="submit" className="users-yellow-button" disabled={isSaving}>
              {isSaving && <InlineSpinner />}
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ORGANIZATIONS_PER_PAGE = 100;

export default function OrganizationsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<OrganizationFilter>("all");
  const [page, setPage] = useState(1);
  const [editingOrganization, setEditingOrganization] = useState<EducationOrganization | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [draft, setDraft] = useState<EducationOrganizationInput>(EMPTY_ORGANIZATION);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingOrganizationId, setDeletingOrganizationId] = useState<string | null>(null);
  const busyOpRef = useRef(false);
  const exportingRef = useRef(false);
  const canManage = profile?.role === "admin";
  const isDirectoryBusy = isImporting || isDeletingAll || Boolean(deletingOrganizationId);
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

  const pageCount = Math.max(1, Math.ceil(filteredOrganizations.length / ORGANIZATIONS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleOrganizations = filteredOrganizations.slice(
    (currentPage - 1) * ORGANIZATIONS_PER_PAGE,
    currentPage * ORGANIZATIONS_PER_PAGE,
  );
  const selectType = (next: OrganizationFilter) => {
    setFilter(next);
    setPage(1);
  };

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
    if (!canManage || busyOpRef.current) return;
    const normalized = normalizeOrganizationInput(draft);
    const validationError = validateOrganizationInput(normalized);
    if (validationError) {
      showToast(validationError, "warning");
      return;
    }

    busyOpRef.current = true;
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
      await queryClient.invalidateQueries({ queryKey: ["education-organizations"] });
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось сохранить организацию"), "error");
    } finally {
      busyOpRef.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = async (organization: EducationOrganization) => {
    if (!canManage || busyOpRef.current) return;
    if (!window.confirm(`Удалить организацию «${organization.alias}» из действующего справочника? В сохранённых ответах она останется. Повторное добавление или импорт восстановит её.`)) return;
    busyOpRef.current = true;
    setDeletingOrganizationId(organization.id);
    try {
      await deleteOrganization(organization.id);
      await queryClient.invalidateQueries({ queryKey: ["education-organizations"] });
      showToast("Организация удалена", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось удалить организацию"), "error");
    } finally {
      busyOpRef.current = false;
      setDeletingOrganizationId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!canManage || organizations.length === 0 || busyOpRef.current) return;
    if (!window.confirm(`Удалить все организации (${organizations.length}) из действующего справочника? В сохранённых ответах они останутся. Повторный импорт восстановит совпадающие организации.`)) return;
    busyOpRef.current = true;
    setIsDeletingAll(true);
    try {
      await deleteAllOrganizations();
      await queryClient.invalidateQueries({ queryKey: ["education-organizations"] });
      showToast("Справочник очищен", "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось очистить справочник"), "error");
    } finally {
      busyOpRef.current = false;
      setIsDeletingAll(false);
    }
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file || !canManage || busyOpRef.current) return;
    busyOpRef.current = true;
    setIsImporting(true);
    try {
      const inputs = await parseOrganizationsXlsx(file);
      await importOrganizations(inputs);
      await queryClient.invalidateQueries({ queryKey: ["education-organizations"] });
      showToast(`Импортировано организаций: ${inputs.length}`, "success");
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось импортировать XLSX"), "error");
    } finally {
      busyOpRef.current = false;
      setIsImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    if (filteredOrganizations.length === 0 || exportingRef.current) return;
    exportingRef.current = true;
    setIsExporting(true);
    try {
      await exportOrganizationsXlsx(filteredOrganizations);
    } catch (error) {
      showToast(getErrorMessage(error, "Не удалось экспортировать справочник"), "error");
    } finally {
      exportingRef.current = false;
      setIsExporting(false);
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
              <button type="button" className="responses-export-button" onClick={openCreateModal} disabled={isDirectoryBusy}>
                Добавить +
              </button>
            )}
            <button
              type="button"
              className="responses-export-button organizations-file-button"
              onClick={() => importInputRef.current?.click()}
              disabled={!canManage || isDirectoryBusy}
              title={!canManage ? "Импорт доступен администратору" : undefined}
            >
              {isImporting && <InlineSpinner />}
              Импорт XLSX
              <Icon name="upload" className="toolbar-icon" size={18} />
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
              onClick={() => void handleExport()}
              disabled={filteredOrganizations.length === 0 || isExporting}
            >
              {isExporting && <InlineSpinner />}
              Экспорт XLSX
              <Icon name="download" className="toolbar-icon" size={18} />
            </button>
            <button
              type="button"
              className="responses-export-button organizations-delete-all-button"
              onClick={() => void handleDeleteAll()}
              disabled={!canManage || organizations.length === 0 || isDirectoryBusy}
              title={!canManage ? "Удаление доступно администратору" : undefined}
            >
              {isDeletingAll ? "Удаление…" : "Удалить все"}
              <Icon name="delete" className="toolbar-icon" size={18} />
            </button>
          </div>
        </div>

        <AnimatedTabs className="organizations-type-switcher" role="tablist" aria-label="Типы образовательных учреждений">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={filter === "all" ? "active" : ""}
            onClick={() => selectType("all")}
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
              onClick={() => selectType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </AnimatedTabs>

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
          <div className="users-table-shell organizations-table-shell" role="region" aria-label="Справочник ОУ, прокрутка по горизонтали" tabIndex={0}>
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
                {visibleOrganizations.map((organization) => (
                  <tr key={organization.id}>
                    <td>{getOrganizationTypeLabel(organization.organization_type, true)}</td>
                    <td>{organization.number ?? "—"}</td>
                    <td>{organization.alias}</td>
                    <td><a href={`mailto:${organization.email}`}>{organization.email}</a></td>
                    {canManage && (
                      <td>
                        <div className="organizations-row-actions">
                          <button type="button" className="organization-edit-button" onClick={() => openEditModal(organization)} disabled={isDirectoryBusy}>
                            Изменить
                            <Icon name="edit" size={18} />
                          </button>
                          <button type="button" className="danger organization-delete-button" onClick={() => void handleDelete(organization)} disabled={isDirectoryBusy}>
                            {deletingOrganizationId === organization.id && <InlineSpinner />}
                            Удалить
                            <Icon name="delete" size={18} />
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
        {pageCount > 1 && (
          <nav className="responses-pagination" aria-label="Страницы справочника">
            <button type="button" className="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Назад</button>
            <span aria-live="polite">Страница {currentPage} из {pageCount}</span>
            <button type="button" className="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Далее</button>
          </nav>
        )}
      </div>

      <Presence kind="modal">{isModalOpen && (
        <OrganizationEditModal
          draft={draft}
          editingOrganization={editingOrganization}
          isSaving={isSaving}
          onClose={closeModal}
          onSave={handleSave}
          setDraft={setDraft}
        />
      )}</Presence>
    </div>
  );
}
