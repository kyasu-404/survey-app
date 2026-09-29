import { Presence } from "../../../shared/ui/Presence";
import { useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FORM_REASON_OPTIONS, REGULAR_FORM_TYPE_OPTIONS } from "../../../entities/survey/model/formOptions";
import type { FormsSort } from "../../../entities/survey/types";
import viewBlack from "../../../img/FormatViewBlack.svg";
import viewWhite from "../../../img/FormatViewWhite.svg";
import infoIcon from "../../../img/info.svg";
import searchIcon from "../../../img/search.svg";
import type { DashboardLayout, DashboardViewMode, OpenMenuState } from "../types";

type DashboardToolbarProps = {
  layout: DashboardLayout;
  onToggleLayout: () => void;
  sort: FormsSort;
  onSortChange: (sort: FormsSort) => void;
  activeFormsCount: number;
  dateFrom: string;
  dateTo: string;
  formReason: string;
  formType: string;
  formsWithDeadlineCount: number;
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
  layout,
  onToggleLayout,
  sort,
  onSortChange,
  activeFormsCount,
  dateFrom,
  dateTo,
  formReason,
  formType,
  formsWithDeadlineCount,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const filtersId = useId();
  const customSort = sort.field !== "created_at" || sort.direction !== "desc";
  const activeFilterCount = [dateFrom || dateTo, formType, formReason, customSort].filter(Boolean).length;
  const resetFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setFormType("");
    setFormReason("");
    onSortChange({ field: "created_at", direction: "desc" });
  };

  return (
    <div className="dashboard-toolbar">
      <div className="dashboard-search-group">
        <div className="dashboard-search-input-shell">
          <img src={searchIcon} alt="" aria-hidden="true" className="dashboard-search-icon" />
          <input
            className="dashboard-search-input"
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="dashboard-info-button dashboard-layout-toggle"
          aria-label={layout === "cards" ? "Показать таблицу" : "Показать карточки"}
          title={layout === "cards" ? "Показать таблицу" : "Показать карточки"}
          aria-pressed={layout === "table"}
          onClick={onToggleLayout}
        >
          <img src={viewBlack} alt="" aria-hidden="true" className="dashboard-view-icon-light" />
          <img src={viewWhite} alt="" aria-hidden="true" className="dashboard-view-icon-dark" />
        </button>
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
          <Presence kind="menu">{openedMenu?.kind === "stats" && (
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
          )}</Presence>
        </div>
      </div>

      <button
        ref={filtersButton}
        type="button"
        className="app-button dashboard-filters-toggle"
        aria-expanded={filtersOpen}
        aria-controls={filtersId}
        onClick={() => setFiltersOpen((open) => !open)}
      >
        Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        <span aria-hidden="true">{filtersOpen ? "−" : "+"}</span>
      </button>
      <div id={filtersId} className="dashboard-filter-group dashboard-filters-popover" role="region" aria-label="Фильтры форм" hidden={!filtersOpen}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setFiltersOpen(false);
            filtersButton.current?.focus();
          }
        }}>
        <fieldset className="dashboard-filter-field dashboard-date-range">
          <legend>Период создания</legend>
          <div className="dashboard-date-range-inputs">
            <label className="dashboard-date-bound"><span>С</span><input type="date" aria-label="Дата с" title="Дата с" max={dateTo || undefined} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <span aria-hidden="true">—</span>
            <label className="dashboard-date-bound"><span>По</span><input type="date" aria-label="Дата по" title="Дата по" min={dateFrom || undefined} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          </div>
        </fieldset>
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
        <label className="dashboard-filter-field">
          <span>Сортировка</span>
          <select value={`${sort.field}:${sort.direction}`} onChange={event => {
            const [field, direction] = event.target.value.split(":") as [FormsSort["field"], FormsSort["direction"]];
            onSortChange({ field, direction });
          }}>
            <option value="created_at:desc">Сначала новые</option>
            <option value="created_at:asc">Сначала старые</option>
            <option value="status:desc">Сначала открытые</option>
            <option value="status:asc">Сначала закрытые</option>
            <option value="title:asc">Название: А–Я</option>
            <option value="title:desc">Название: Я–А</option>
            <option value="responses_count:desc">Больше ответов</option>
            <option value="responses_count:asc">Меньше ответов</option>
            <option value="classification:asc">Тип и основание: А–Я</option>
            <option value="classification:desc">Тип и основание: Я–А</option>
            <option value="author_name:asc">Автор: А–Я</option>
            <option value="author_name:desc">Автор: Я–А</option>
          </select>
        </label>
        <button type="button" className="app-button dashboard-filters-reset" disabled={!search && activeFilterCount === 0} onClick={resetFilters}>Сбросить</button>
      </div>
    </div>
  );
}
