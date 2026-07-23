import type { Dispatch, SetStateAction } from "react";
import searchIcon from "../../../img/search.svg";
import type { UsersRoleFilter, UsersStatusFilter } from "../types";

type UsersFiltersBarProps = {
  roleFilter: UsersRoleFilter;
  search: string;
  setRoleFilter: Dispatch<SetStateAction<UsersRoleFilter>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setStatusFilter: Dispatch<SetStateAction<UsersStatusFilter>>;
  statusFilter: UsersStatusFilter;
};

export function UsersFiltersBar({
  roleFilter,
  search,
  setRoleFilter,
  setSearch,
  setStatusFilter,
  statusFilter,
}: UsersFiltersBarProps) {
  return (
    <div className="users-filters-grid">
      <label className="users-filter-field users-search-field">
        <div className="users-search-input-shell">
          <img src={searchIcon} alt="" aria-hidden="true" className="users-search-icon" />
          <input
            type="search"
            aria-label="Поиск по имени"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Введите имя для поиска"
          />
        </div>
      </label>
      <label className="users-filter-field">
        <span>Роль</span>
        <select aria-label="Фильтр по роли" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UsersRoleFilter)}>
          <option value="all">Все роли</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label className="users-filter-field">
        <span>Статус</span>
        <select aria-label="Фильтр по статусу" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as UsersStatusFilter)}>
          <option value="all">Все статусы</option>
          <option value="active">Активен</option>
          <option value="disabled">Отключён</option>
        </select>
      </label>
    </div>
  );
}
