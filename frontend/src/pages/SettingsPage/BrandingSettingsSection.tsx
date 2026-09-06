import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../app/providers/ToastProvider";
import {
  APP_BRANDING_QUERY_KEY,
  APP_LOGO_ACCEPT,
  getAppBranding,
  resetAppLogo,
  uploadAppLogo,
  validateAppLogoFile,
} from "../../entities/branding/api";
import { getDefaultAppLogo } from "../../entities/branding/defaultLogo";
import { getErrorMessage } from "../../shared/lib/error";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";
import { Skeleton } from "../../shared/ui/Skeleton";

export function BrandingSettingsSection() {
  const { showToast } = useToast();
  const { themeId } = useTheme();
  const defaultLogo = getDefaultAppLogo(themeId);
  const queryClient = useQueryClient();
  const brandingQuery = useQuery({
    queryKey: APP_BRANDING_QUERY_KEY,
    queryFn: getAppBranding,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localPreviewUrl = useMemo(() => {
    if (!selectedFile || typeof URL.createObjectURL !== "function") return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => () => {
    if (localPreviewUrl && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(localPreviewUrl);
    }
  }, [localPreviewUrl]);

  const previewUrl = localPreviewUrl ?? brandingQuery.data?.sidebarLogoUrl ?? defaultLogo;
  const backendError = brandingQuery.error
    ? getErrorMessage(brandingQuery.error, "Не удалось загрузить настройки логотипа")
    : null;

  const handleFileChange = (file: File | undefined) => {
    if (!file) return;
    try {
      validateAppLogoFile(file);
      setSelectedFile(file);
      setError(null);
    } catch (fileError) {
      setSelectedFile(null);
      setError(getErrorMessage(fileError, "Не удалось выбрать логотип"));
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await uploadAppLogo(selectedFile);
      queryClient.setQueryData(APP_BRANDING_QUERY_KEY, saved);
      setSelectedFile(null);
      showToast("Основной логотип обновлён", "success");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Не удалось сохранить логотип"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);
    try {
      const saved = await resetAppLogo();
      queryClient.setQueryData(APP_BRANDING_QUERY_KEY, saved);
      setSelectedFile(null);
      showToast("Восстановлен стандартный логотип", "success");
    } catch (resetError) {
      setError(getErrorMessage(resetError, "Не удалось восстановить стандартный логотип"));
    } finally {
      setIsResetting(false);
    }
  };

  const isBusy = isSaving || isResetting;

  return (
    <section className="settings-area settings-branding-area" aria-labelledby="branding-settings-heading">
      <div className="settings-area-heading">
        <div>
          <p>Оформление</p>
          <h2 id="branding-settings-heading">Основной логотип</h2>
          <span>Общий логотип отображается в левом меню у всех сотрудников во всех темах. Стандартный логотип в тёмной теме — белый.</span>
        </div>
      </div>

      {brandingQuery.isLoading ? (
        <div className="settings-branding-skeleton" aria-hidden="true">
          <Skeleton className="settings-branding-preview-skeleton" />
          <Skeleton className="settings-field-skeleton" />
        </div>
      ) : (
        <div className="settings-section settings-branding-section">
          {backendError && (
            <div className="settings-backend-warning" role="alert">
              <div>
                <strong>Настройки оформления пока недоступны</strong>
                <p>{backendError}</p>
              </div>
              <button type="button" className="users-page-retry-button" onClick={() => void brandingQuery.refetch()}>
                Проверить снова
              </button>
            </div>
          )}

          <div className="settings-branding-content">
            <div className="settings-branding-preview">
              <span>Предпросмотр</span>
              <div className="settings-branding-preview-frame">
                <img src={previewUrl} alt="Предпросмотр основного логотипа" />
              </div>
            </div>

            <div className="settings-branding-controls">
              <div>
                <strong>{selectedFile?.name ?? (brandingQuery.data?.sidebarLogoPath ? "Пользовательский логотип" : "Стандартный логотип")}</strong>
                <p>PNG, JPG или WebP, не более 2 МБ. Лучше использовать квадратное изображение с прозрачным фоном.</p>
              </div>

              <div className="settings-branding-actions">
                <label className={`app-button settings-logo-file-button ${isBusy || Boolean(backendError) ? "disabled" : ""}`}>
                  <input
                    type="file"
                    accept={APP_LOGO_ACCEPT}
                    disabled={isBusy || Boolean(backendError)}
                    onChange={(event) => {
                      handleFileChange(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  Выбрать изображение
                </label>
                <button
                  type="button"
                  className="button-primary"
                  disabled={!selectedFile || isBusy || Boolean(backendError)}
                  onClick={() => void handleSave()}
                >
                  {isSaving && <InlineSpinner />}
                  {isSaving ? "Сохранение…" : "Сохранить логотип"}
                </button>
                <button
                  type="button"
                  className="app-button"
                  disabled={(!brandingQuery.data?.sidebarLogoPath && !selectedFile) || isBusy || Boolean(backendError)}
                  onClick={() => void handleReset()}
                >
                  {isResetting && <InlineSpinner />}
                  Вернуть стандартный
                </button>
              </div>
            </div>
          </div>

          {error && <p className="settings-form-error" role="alert">{error}</p>}
        </div>
      )}
    </section>
  );
}
