import { ModalHeading } from "../../shared/ui/ModalHeading";
import { useId, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { hasOrganizationQuestion } from "../../entities/organization/model";
import type { FormSaveSettings } from "../../entities/survey/api/surveysApi";
import { FORM_REASON_OPTIONS, REGULAR_FORM_TYPE_OPTIONS } from "../../entities/survey/model/formOptions";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { useLegacyModalDialog } from "../../shared/ui/useLegacyModalDialog";
import { OrganizationTypeSettings } from "./OrganizationTypeSettings";
import type { CompatibilityDialogState, PostSaveSettingsState } from "./builderTypes";

export function BuilderResetDialog({ isSurveyMutationBusy, isTemplateBusy, setIsResetConfirmOpen, handleResetBuilder }: {
  isSurveyMutationBusy: boolean;
  isTemplateBusy: boolean;
  setIsResetConfirmOpen: (open: boolean) => void;
  handleResetBuilder: () => void;
}) {
  const titleId = useId();
  const isBusy = isSurveyMutationBusy || isTemplateBusy;
  const dialogRef = useLegacyModalDialog({ onClose: () => setIsResetConfirmOpen(false), disabled: isBusy });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isBusy && setIsResetConfirmOpen(false)}>
      <div
        ref={dialogRef}
        className="modal-card card builder-reset-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeading onClose={() => setIsResetConfirmOpen(false)} disabled={isBusy}>
          <h3 id={titleId} className="builder-reset-title">Сбросить конструктор?</h3>
        </ModalHeading>
        <p className="builder-template-subtitle">
          Все несохранённые вопросы и поля будут очищены. Это действие нельзя отменить.
        </p>
        <div className="deadline-modal-actions">
          <button
            type="button"
            className="deadline-action-cancel-button"
            onClick={() => setIsResetConfirmOpen(false)}
            disabled={isBusy}
          >
            Отмена
          </button>
          <button
            type="button"
            className="deadline-clear-button"
            onClick={handleResetBuilder}
            disabled={isBusy}
          >
            Сбросить
          </button>
        </div>
      </div>
    </div>
  );
}

export function BuilderCompatibilityDialog({ compatibilityDialog, isCompatibilityCopying, isSaving, handleCreateCompatibilityCopy, handleCloseCompatibilityDialog, handleConfirmCompatibilityWarnings }: {
  compatibilityDialog: CompatibilityDialogState;
  isCompatibilityCopying: boolean;
  isSaving: boolean;
  handleCreateCompatibilityCopy: () => Promise<void>;
  handleCloseCompatibilityDialog: () => void;
  handleConfirmCompatibilityWarnings: () => Promise<void>;
}) {
  const titleId = useId();
  const isBusy = isCompatibilityCopying || isSaving;
  const dialogRef = useLegacyModalDialog({ onClose: handleCloseCompatibilityDialog, disabled: isBusy });

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isBusy && handleCloseCompatibilityDialog()}>
      <div
        ref={dialogRef}
        className="modal-card card builder-compatibility-modal"
        role="dialog"
        aria-modal="true"
        aria-label={compatibilityDialog.result.status === "blocked"
          ? "Несовместимые изменения формы"
          : "Предупреждение об изменениях формы"}
        tabIndex={-1}
      >
        <ModalHeading onClose={handleCloseCompatibilityDialog} disabled={isBusy}>
          <h3 id={titleId} className="builder-reset-title">
            {compatibilityDialog.result.status === "blocked"
              ? "Некоторые изменения несовместимы с полученными ответами"
              : "Подтвердите изменения формы"}
          </h3>
        </ModalHeading>
        <p className="builder-template-subtitle">
          {compatibilityDialog.result.status === "blocked"
            ? "Эти изменения нельзя сохранить в текущей форме. Создайте копию, чтобы продолжить без риска для ответов."
            : "Изменения будут применяться только к новым ответам. Ранее полученные ответы останутся без новых значений."}
        </p>
        <ul className="builder-compatibility-list">
          {(compatibilityDialog.result.status === "blocked"
            ? compatibilityDialog.result.breakingChanges
            : compatibilityDialog.result.warnings
          ).map((message) => <li key={message}>{message}</li>)}
        </ul>
        <div className="deadline-modal-actions">
          {compatibilityDialog.result.status === "blocked" ? (
            <>
              <button
                type="button"
                className="deadline-save-button"
                onClick={() => void handleCreateCompatibilityCopy()}
                disabled={isCompatibilityCopying}
              >
                {isCompatibilityCopying && <InlineSpinner />}
                Создать копию
              </button>
              <button
                type="button"
                className="deadline-action-cancel-button"
                onClick={handleCloseCompatibilityDialog}
                disabled={isCompatibilityCopying}
              >
                Вернуться к форме
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="deadline-save-button"
                onClick={() => void handleConfirmCompatibilityWarnings()}
                disabled={isSaving}
              >
                {isSaving && <InlineSpinner />}
                Сохранить изменения
              </button>
              <button
                type="button"
                className="deadline-action-cancel-button"
                onClick={handleCloseCompatibilityDialog}
                disabled={isSaving}
              >
                Отмена
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type SettingsField = "formType" | "formReason" | "deadlineAt" | "maxResponses";
type SettingsFieldErrors = Partial<Record<SettingsField, string>>;

export function BuilderFormSettingsDialog({ postSaveSettings, setPostSaveSettings, isPostSaveSettingsSaving, closePostSaveSettings, handleSavePostSaveSettings }: {
  postSaveSettings: PostSaveSettingsState;
  setPostSaveSettings: Dispatch<SetStateAction<PostSaveSettingsState | null>>;
  isPostSaveSettingsSaving: boolean;
  closePostSaveSettings: () => void;
  handleSavePostSaveSettings: (settings: Required<FormSaveSettings>) => Promise<void>;
}) {
  const [fieldErrors, setFieldErrors] = useState<SettingsFieldErrors>({});
  const errorId = useId();
  const titleId = useId();
  const dialogRef = useLegacyModalDialog<HTMLFormElement>({ onClose: closePostSaveSettings, disabled: isPostSaveSettingsSaving });
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const limitInputRef = useRef<HTMLInputElement>(null);

  const clearFieldError = (field: SettingsField) => {
    setFieldErrors((errors) => errors[field] ? { ...errors, [field]: undefined } : errors);
  };
  const getFieldErrorAttributes = (field: SettingsField) => ({
    "aria-invalid": fieldErrors[field] ? true : undefined,
    "aria-describedby": fieldErrors[field] ? `${errorId}-${field}` : undefined,
  });
  const renderFieldError = (field: SettingsField) => fieldErrors[field] && (
    <small id={`${errorId}-${field}`} className="builder-settings-field-error" role="alert">{fieldErrors[field]}</small>
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPostSaveSettingsSaving) return;

    const formType = postSaveSettings.formTypeValue.trim();
    const formReason = postSaveSettings.formReasonValue.trim();
    const deadlineValue = postSaveSettings.deadlineValue.trim();
    const responseLimitValue = postSaveSettings.responseLimitValue.trim();
    const deadline = deadlineValue ? new Date(deadlineValue) : null;
    const maxResponses = responseLimitValue ? Number(responseLimitValue) : null;
    const errors: SettingsFieldErrors = {};

    if (!formType) errors.formType = "Выберите тип формы.";
    if (!formReason) errors.formReason = "Выберите основание формы.";
    if (deadlineInputRef.current?.validity.badInput || (deadline && !Number.isFinite(deadline.getTime()))) {
      errors.deadlineAt = "Укажите дату и время дедлайна полностью или очистите поле.";
    }
    if (limitInputRef.current?.validity.badInput
      || (maxResponses !== null && (!Number.isInteger(maxResponses) || maxResponses < 1 || maxResponses > 100_000))) {
      errors.maxResponses = "Укажите целое число ответов от 1 до 100 000.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    void handleSavePostSaveSettings({ formType, formReason, deadlineAt: deadline?.toISOString() ?? null, maxResponses });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !isPostSaveSettingsSaving && closePostSaveSettings()}>
      <form
        ref={dialogRef}
        noValidate
        onSubmit={handleSubmit}
        className="modal-card card deadline-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <ModalHeading onClose={closePostSaveSettings} disabled={isPostSaveSettingsSaving}>
          <h3 id={titleId} className="deadline-modal-title">Настройки формы</h3>
        </ModalHeading>
        <p className="deadline-modal-subtitle">{postSaveSettings.title}</p>
        <div className="deadline-modal-primary-grid">
          <label className="deadline-field">
            <span>
              Тип формы <span className="deadline-required-mark" aria-hidden="true">*</span>
            </span>
            <div className="deadline-select-shell">
              <select
                aria-label="Тип формы"
                value={postSaveSettings.formTypeValue}
                {...getFieldErrorAttributes("formType")}
                onChange={(event) => {
                  clearFieldError("formType");
                  setPostSaveSettings((current) =>
                    current ? { ...current, formTypeValue: event.target.value } : current,
                  );
                }}
              >
                <option value="" disabled hidden />
                {REGULAR_FORM_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!postSaveSettings.formTypeValue && (
                <span className="deadline-select-placeholder" aria-hidden="true">
                  Выберите тип
                </span>
              )}
            </div>
            {renderFieldError("formType")}
          </label>
          <label className="deadline-field">
            <span>
              Основание формы <span className="deadline-required-mark" aria-hidden="true">*</span>
            </span>
            <div className="deadline-select-shell">
              <select
                aria-label="Основание формы"
                value={postSaveSettings.formReasonValue}
                {...getFieldErrorAttributes("formReason")}
                onChange={(event) => {
                  clearFieldError("formReason");
                  setPostSaveSettings((current) =>
                    current ? { ...current, formReasonValue: event.target.value } : current,
                  );
                }}
              >
                <option value="" disabled hidden />
                {FORM_REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!postSaveSettings.formReasonValue && (
                <span className="deadline-select-placeholder" aria-hidden="true">
                  Выберите основание
                </span>
              )}
            </div>
            {renderFieldError("formReason")}
          </label>
        </div>
        <label className="deadline-field">
          <span>Дедлайн</span>
          <input
            ref={deadlineInputRef}
            type="datetime-local"
            aria-label="Дедлайн"
            value={postSaveSettings.deadlineValue}
            {...getFieldErrorAttributes("deadlineAt")}
            onChange={(event) => {
              clearFieldError("deadlineAt");
              setPostSaveSettings((current) =>
                current ? { ...current, deadlineValue: event.target.value, deadlineChanged: true } : current,
              );
            }}
          />
          {renderFieldError("deadlineAt")}
        </label>
        <label className="deadline-field">
          <span>Лимит ответов</span>
          <input
            ref={limitInputRef}
            type="number"
            aria-label="Лимит ответов"
            min={1}
            max={100000}
            step={1}
            inputMode="numeric"
            value={postSaveSettings.responseLimitValue}
            {...getFieldErrorAttributes("maxResponses")}
            onChange={(event) => {
              clearFieldError("maxResponses");
              setPostSaveSettings((current) =>
                current ? { ...current, responseLimitValue: event.target.value, responseLimitChanged: true } : current,
              );
            }}
          />
          {renderFieldError("maxResponses")}
        </label>
        <div className="builder-response-settings builder-response-settings-modal">
          <div>
            <strong>Редактирование ответов</strong>
            <span>Разрешить респонденту менять уже отправленный ответ.</span>
          </div>
          <button
            type="button"
            className={`settings-toggle ${postSaveSettings.allowResponseEditing ? "settings-toggle-active" : ""}`.trim()}
            role="switch"
            aria-checked={postSaveSettings.allowResponseEditing}
            aria-label="Редактирование ответов"
            onClick={() => setPostSaveSettings((current) => current ? {
              ...current,
              allowResponseEditing: !current.allowResponseEditing,
            } : current)}
            disabled={isPostSaveSettingsSaving}
          >
            <span aria-hidden="true" />
          </button>
        </div>
        {hasOrganizationQuestion(postSaveSettings.schema) && (
          <OrganizationTypeSettings
            className="builder-organization-settings-modal"
            selectedTypes={postSaveSettings.organizationTypes}
            onChange={(types) => setPostSaveSettings((current) => current ? {
              ...current,
              organizationTypes: types,
            } : current)}
            disabled={isPostSaveSettingsSaving}
          />
        )}
        <p className="deadline-modal-hint">
          Дедлайн и лимит ответов можно оставить пустыми.
        </p>
        <div className="deadline-modal-actions">
          <button type="button" className="deadline-action-cancel-button" onClick={closePostSaveSettings} disabled={isPostSaveSettingsSaving}>
            Отмена
          </button>
          <button type="submit" className="deadline-save-button" disabled={isPostSaveSettingsSaving}>
            {isPostSaveSettingsSaving && <InlineSpinner />}
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

