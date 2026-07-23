import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../../shared/lib/error";
import {
  SURVEY_BACKGROUND_ACCEPT,
  listCommonSurveyBackgrounds,
  listCustomSurveyBackgrounds,
  removeSurveyBackground,
  uploadSurveyBackground,
  type SurveyBackgroundAsset,
} from "../../shared/api/themeAssets";
import { InlineSpinner } from "../../shared/ui/InlineSpinner";

type ThemeBackgroundGalleryProps = {
  currentBackground?: string;
  formId: string;
  ownerId: string;
  onApply: (backgroundUrl: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

function BackgroundCard({
  asset,
  currentBackground,
  isDeleting,
  onApply,
  onDelete,
}: {
  asset: SurveyBackgroundAsset;
  currentBackground?: string;
  isDeleting: boolean;
  onApply: (asset: SurveyBackgroundAsset) => void;
  onDelete?: (asset: SurveyBackgroundAsset) => void;
}) {
  const isSelected = currentBackground === asset.url;

  return (
    <article className={isSelected ? "theme-background-card theme-background-card-selected" : "theme-background-card"}>
      <button type="button" className="theme-background-preview" onClick={() => onApply(asset)} aria-pressed={isSelected}>
        <img src={asset.url} alt="" loading="lazy" />
        {isSelected && <span className="theme-background-selected-badge">Выбран</span>}
      </button>
      <div className="theme-background-card-meta">
        <span title={asset.name}>{asset.name}</span>
        {onDelete && (
          <button
            type="button"
            className="theme-background-delete"
            onClick={() => onDelete(asset)}
            disabled={isDeleting}
            aria-label={`Удалить фон ${asset.name}`}
          >
            {isDeleting ? "…" : "Удалить"}
          </button>
        )}
      </div>
    </article>
  );
}

export function ThemeBackgroundGallery({
  currentBackground,
  formId,
  ownerId,
  onApply,
  onClose,
  onError,
}: ThemeBackgroundGalleryProps) {
  const [commonBackgrounds, setCommonBackgrounds] = useState<SurveyBackgroundAsset[]>([]);
  const [customBackgrounds, setCustomBackgrounds] = useState<SurveyBackgroundAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshCustomBackgrounds = async () => {
    setCustomBackgrounds(await listCustomSurveyBackgrounds(formId, ownerId));
  };

  useEffect(() => {
    let active = true;
    setIsLoading(true);

    Promise.all([listCommonSurveyBackgrounds(), listCustomSurveyBackgrounds(formId, ownerId)])
      .then(([common, custom]) => {
        if (!active) return;
        setCommonBackgrounds(common);
        setCustomBackgrounds(custom);
      })
      .catch((error) => {
        if (active) onError(getErrorMessage(error, "Не удалось загрузить галерею фонов"));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [formId, onError, ownerId]);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true);
    try {
      const uploaded = await uploadSurveyBackground(formId, ownerId, file);
      onApply(uploaded.url);
      await refreshCustomBackgrounds();
    } catch (error) {
      onError(getErrorMessage(error, "Не удалось загрузить фон"));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async (asset: SurveyBackgroundAsset) => {
    setDeletingAssetId(asset.id);
    try {
      await removeSurveyBackground(asset);
      if (currentBackground === asset.url) onApply("");
      await refreshCustomBackgrounds();
    } catch (error) {
      onError(getErrorMessage(error, "Не удалось удалить фон"));
    } finally {
      setDeletingAssetId(null);
    }
  };

  return (
    <div className="modal-backdrop theme-background-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card card theme-background-modal" role="dialog" aria-modal="true" aria-label="Галерея фонов">
        <div className="theme-background-modal-header">
          <div>
            <h3>Галерея фонов</h3>
            <p>Общие фоны доступны всем. Пользовательские принадлежат этой форме.</p>
          </div>
          <button type="button" className="theme-background-close" onClick={onClose}>Закрыть</button>
        </div>

        {isLoading ? (
          <div className="theme-background-loading" role="status">
            <InlineSpinner />
            <span>Загрузка галереи</span>
          </div>
        ) : (
          <div className="theme-background-sections">
            <section>
              <div className="theme-background-section-title">
                <div>
                  <h4>Общие фоны</h4>
                  <p>Готовые изображения и содержимое папки <code>gallery/</code> в Supabase.</p>
                </div>
                <button type="button" className="theme-background-none" onClick={() => onApply("")} aria-pressed={!currentBackground}>
                  Без фона
                </button>
              </div>
              <div className="theme-background-grid">
                {commonBackgrounds.map((asset) => (
                  <BackgroundCard
                    key={asset.id}
                    asset={asset}
                    currentBackground={currentBackground}
                    isDeleting={false}
                    onApply={(selected) => onApply(selected.url)}
                  />
                ))}
              </div>
            </section>

            <section>
              <div className="theme-background-section-title">
                <div>
                  <h4>Мои фоны</h4>
                  <p>JPG, PNG или WebP, не больше 5 МБ.</p>
                </div>
                <button
                  type="button"
                  className="theme-background-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? "Загрузка…" : "Загрузить свой"}
                </button>
                <input
                  ref={fileInputRef}
                  className="theme-background-file-input"
                  type="file"
                  accept={SURVEY_BACKGROUND_ACCEPT}
                  onChange={(event) => void handleUpload(event.target.files?.[0])}
                />
              </div>
              {customBackgrounds.length === 0 ? (
                <p className="theme-background-empty">Пользовательских фонов пока нет.</p>
              ) : (
                <div className="theme-background-grid">
                  {customBackgrounds.map((asset) => (
                    <BackgroundCard
                      key={asset.id}
                      asset={asset}
                      currentBackground={currentBackground}
                      isDeleting={deletingAssetId === asset.id}
                      onApply={(selected) => onApply(selected.url)}
                      onDelete={(selected) => void handleDelete(selected)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
