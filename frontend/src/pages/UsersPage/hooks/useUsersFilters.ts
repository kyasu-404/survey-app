import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UserProfile } from "../../../entities/user/types";
import type { UsersRoleFilter, UsersStatusFilter } from "../types";
import { getUsersPageSessionState, updateUsersPageSessionState } from "../usersPageSessionState";

export function useUsersFilters(users: UserProfile[]) {
  const queryClient = useQueryClient();
  const [search, setSearchState] = useState(() => getUsersPageSessionState(queryClient).search);
  const [roleFilter, setRoleFilterState] = useState<UsersRoleFilter>(() => getUsersPageSessionState(queryClient).roleFilter);
  const [statusFilter, setStatusFilterState] = useState<UsersStatusFilter>(() => getUsersPageSessionState(queryClient).statusFilter);

  const setSearch = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => {
      setSearchState((currentValue) => {
        const nextValue = typeof value === "function" ? value(currentValue) : value;
        updateUsersPageSessionState(queryClient, { search: nextValue });

        return nextValue;
      });
    },
    [queryClient],
  );

  const setRoleFilter = useCallback<Dispatch<SetStateAction<UsersRoleFilter>>>(
    (value) => {
      setRoleFilterState((currentValue) => {
        const nextValue = typeof value === "function" ? value(currentValue) : value;
        updateUsersPageSessionState(queryClient, { roleFilter: nextValue });

        return nextValue;
      });
    },
    [queryClient],
  );

  const setStatusFilter = useCallback<Dispatch<SetStateAction<UsersStatusFilter>>>(
    (value) => {
      setStatusFilterState((currentValue) => {
        const nextValue = typeof value === "function" ? value(currentValue) : value;
        updateUsersPageSessionState(queryClient, { statusFilter: nextValue });

        return nextValue;
      });
    },
    [queryClient],
  );

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return users.filter((profile) => {
      const matchesSearch = normalizedSearch ? (profile.name ?? "").toLowerCase().includes(normalizedSearch) : true;
      const matchesRole = roleFilter === "all" ? true : profile.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" ? true : statusFilter === "active" ? !profile.is_disabled : profile.is_disabled;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, search, statusFilter, users]);

  return {
    filteredUsers,
    roleFilter,
    search,
    setRoleFilter,
    setSearch,
    setStatusFilter,
    statusFilter,
  };
}
