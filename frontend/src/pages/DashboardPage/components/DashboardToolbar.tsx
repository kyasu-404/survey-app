import type { Dispatch, SetStateAction } from "react";
import { FORM_REASON_OPTIONS, REGULAR_FORM_TYPE_OPTIONS } from "../../../entities/survey/model/formOptions";
import infoIcon from "../../../img/info.svg";
import searchIcon from "../../../img/search.svg";
import { RefreshButton } from "../../../shared/ui/RefreshButton";
import type { DashboardViewMode, OpenMenuState } from "../types";

type DashboardToolbarProps = {
  activeFormsCount: number;
  dateFrom: string;
  dateTo: string;
  formReason: string;
  formType: string;
  formsUpdatedAt: number;
  formsWithDeadlineCount: number;
  isBackgroundRefreshingForms: boolean;
  isInitialFormsLoading: boolean;
  isRefreshingForms: boolean;
  onRefresh: () => void;
  openedMenu: OpenMenuState;
  search: string;
  setDateFrom: Dispatch<SetStateAction<string>>;
  setDateTo: Dispatch<SetStateAction<string>>;
  setFormReason: Dispatch<SetStateAction<string>>;
  setFormType: Dispatch<SetStateAction<string>>;
  setOpenedMenu: Dispatch<SetStateAction<OpenMenuState>>;
  setSearch: Dispatch<SetStateAction<string>>;
  totalFormsCount: number;
  viewMode: DashboardViewMode;
};

export function DashboardToolbar({
  activeFormsCount,
  dateFrom,
  dateTo,
  formReason,
  formType,
  formsUpdatedAt,
  formsWithDeadlineCount,
  isBackgroundRefreshingForms,
  isInitialFormsLoading,
  isRefreshingForms,
  onRefresh,
  openedMenu,
  search,
  setDateFrom,
  setDateTo,
  setFormReason,
  setFormType,
  setOpenedMenu,
  setSearch,
  totalFormsCount,
  viewMode,
}: DashboardToolbarProps) {
  const searchPlaceholder = viewMode === "mine" ? "Поиск по названию" : "Поиск по названию и автору";

  return (
    <div className="dashboard-toolbar">
      <div className="dashboard-search-group">
        <div className="dashboard-search-input-shell">
          <img src={searchIcon} alt="" aria-hidden="true" className="dashboard-search-icon" />
          <input
            className="dashboard-search-input"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="dashboard-floating-root dashboard-info-box">
          <button
            type="button"
            className="dashboard-info-button"
            aria-label="Статистика форм"
            aria-expanded={openedMenu?.kind === "stats"}
            onClick={() => setOpenedMenu((current) => (current?.kind === "stats" ? null : { kind: "stats" }))}
          >
            <img src={infoIcon} alt="" aria-hidden="true" className="toolbar-icon" />
          </button>
          {openedMenu?.kind === "stats" && (
            <div className="dashboard-stats-popover" role="dialog" aria-label="Сводка по формам">
              <div className="dashboard-stats-item">
                <span>Всего форм</span>
                <strong>{totalFormsCount}</strong>
              </div>
              <div className="dashboard-stats-item">
                <span>Активных</span>
                <strong>{activeFormsCount}</strong>
              </div>
              <div className="dashboard-stats-item">
                <span>С дедлайном</span>
                <strong>{formsWithDeadlineCount}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-filter-group">
        <label className="dashboard-filter-field">
          <span>Дата с</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="dashboard-filter-field">
          <span>Дата по</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="dashboard-filter-field">
          <span>Тип формы</span>
          <select aria-label="Тип формы" value={formType} onChange={(event) => setFormType(event.target.value)}>
            <option value="">Все типы</option>
            {REGULAR_FORM_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dashboard-filter-field">
          <span>Основание формы</span>
          <select aria-label="Основание формы" value={formReason} onChange={(event) => setFormReason(event.target.value)}>
            <option value="">Все основания</option>
            {FORM_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <RefreshButton
          isRefreshing={isRefreshingForms}
          isSyncing={isBackgroundRefreshingForms}
          lastUpdatedAt={formsUpdatedAt}
          onClick={onRefresh}
          disabled={isInitialFormsLoading || isRefreshingForms}
        />
      </div>
    </div>
  );
}
