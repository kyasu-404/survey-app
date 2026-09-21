import { AnimatedTabs } from "../../../shared/ui/AnimatedTabs";
import { RefreshButton } from "../../../shared/ui/RefreshButton";
import type { TemplatesSection } from "../types";

type TemplatesSectionTabsProps = {
  isInitialLoading: boolean;
  isRefreshing: boolean;
  lastUpdatedAt: number;
  onRefresh: () => void;
  onSectionChange: (section: TemplatesSection) => void;
  section: TemplatesSection;
};

export function TemplatesSectionTabs({
  isInitialLoading,
  isRefreshing,
  lastUpdatedAt,
  onRefresh,
  onSectionChange,
  section,
}: TemplatesSectionTabsProps) {
  return (
    <div className="templates-page-actions">
      <AnimatedTabs className="templates-segmented-control" role="tablist" aria-label="Раздел шаблонов">
        <button
          type="button"
          role="tab"
          className={section === "mine" ? "templates-segment templates-segment-active" : "templates-segment"}
          aria-selected={section === "mine"}
          onClick={() => onSectionChange("mine")}
        >
          Мои
        </button>
        <button
          type="button"
          role="tab"
          className={section === "public" ? "templates-segment templates-segment-active" : "templates-segment"}
          aria-selected={section === "public"}
          onClick={() => onSectionChange("public")}
        >
          Публичные
        </button>
      </AnimatedTabs>
      <RefreshButton isRefreshing={isRefreshing} lastUpdatedAt={lastUpdatedAt} onClick={onRefresh} disabled={isInitialLoading || isRefreshing} />
    </div>
  );
}
