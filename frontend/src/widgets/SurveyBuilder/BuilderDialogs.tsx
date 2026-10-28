import type { Dispatch, SetStateAction } from "react";
import { hasOrganizationQuestion } from "../../entities/organization/model";
import { FORM_REASON_OPTIONS, REGULAR_FORM_TYPE_OPTIONS } from "../../entities/survey/model/formOptions";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { OrganizationTypeSettings } from "./OrganizationTypeSettings";
import type { CompatibilityDialogState, PostSaveSettingsState } from "./builderTypes";

export function BuilderResetDialog({ isSurveyMutationBusy, isTemplateBusy, setIsResetConfirmOpen, handleResetBuilder }: {
  isSurveyMutationBusy: boolean;
  isTemplateBusy: boolean;
  setIsResetConfirmOpen: (open: boolean) => void;
  handleResetBuilder: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card builder-reset-modal">
        <h3 className="builder-reset-title">Сбросить конструктор?</h3>
        <p className="builder-template-subtitle">
          Все несохранённые вопросы и поля будут очищены. Это действие нельзя отменить.
        </p>
        <div className="deadline-modal-actions">
          <button
            type="button"
            className="deadline-action-cancel-button"
            onClick={() => setIsResetConfirmOpen(false)}
            disabled={isSurveyMutationBusy || isTemplateBusy}
          >
            Отмена
          </button>
          <button
            type="button"
            className="deadline-clear-button"
            onClick={handleResetBuilder}
            disabled={isSurveyMutationBusy || isTemplateBusy}
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
  return (
    <div className="modal-backdrop">
      <div
        className="modal-card card builder-compatibility-modal"
        role="dialog"
        aria-modal="true"
        aria-label={compatibilityDialog.result.status === "blocked"
          ? "Несовместимые изменения формы"
          : "Предупреждение об изменениях формы"}
      >
        <h3 className="builder-reset-title">
          {compatibilityDialog.result.status === "blocked"
            ? "Некоторые изменения несовместимы с полученными ответами"
            : "Подтвердите изменения формы"}
        </h3>
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

export function BuilderFormSettingsDialog({ postSaveSettings, setPostSaveSettings, isPostSaveSettingsSaving, closePostSaveSettings, handleSavePostSaveSettings }: {
  postSaveSettings: PostSaveSettingsState;
  setPostSaveSettings: Dispatch<SetStateAction<PostSaveSettingsState | null>>;
  isPostSaveSettingsSaving: boolean;
  closePostSaveSettings: () => void;
  handleSavePostSaveSettings: () => Promise<void>;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card card deadline-modal" role="dialog" aria-modal="true" aria-label="Настройки формы">
        <h3 className="deadline-modal-title">Настройки формы</h3>
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
                onChange={(event) =>
                  setPostSaveSettings((current) =>
                    current ? { ...current, formTypeValue: event.target.value } : current,
                  )
                }
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
          </label>
          <label className="deadline-field">
            <span>
              Основание формы <span className="deadline-required-mark" aria-hidden="true">*</span>
            </span>
            <div className="deadline-select-shell">
              <select
                aria-label="Основание формы"
                value={postSaveSettings.formReasonValue}
                onChange={(event) =>
                  setPostSaveSettings((current) =>
                    current ? { ...current, formReasonValue: event.target.value } : current,
                  )
                }
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
          </label>
        </div>
        <label className="deadline-field">
          <span>Дедлайн</span>
          <input
            type="datetime-local"
            value={postSaveSettings.deadlineValue}
            onChange={(event) =>
              setPostSaveSettings((current) =>
                current ? { ...current, deadlineValue: event.target.value } : current,
              )
            }
          />
        </label>
        <label className="deadline-field">
          <span>Лимит ответов</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={postSaveSettings.responseLimitValue}
            onChange={(event) =>
              setPostSaveSettings((current) =>
                current ? { ...current, responseLimitValue: event.target.value } : current,
              )
            }
          />
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
          <button type="button" className="deadline-save-button" onClick={() => void handleSavePostSaveSettings()} disabled={isPostSaveSettingsSaving}>
            {isPostSaveSettingsSaving && <InlineSpinner />}
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

