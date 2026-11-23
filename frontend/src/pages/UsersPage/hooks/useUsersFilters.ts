import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UserProfile } from "../../../entities/user/types";
import type { UsersRoleFilter, UsersStatusFilter } from "../types";
import { getUsersPageSessionState, updateUsersPageSessionState } from "../usersPageSessionState";

export function useUsersFilters(users: UserProfile[]) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(() => getUsersPageSessionState(queryClient).search);
  const [roleFilter, setRoleFilter] = useState<UsersRoleFilter>(() => getUsersPageSessionState(queryClient).roleFilter);
  const [statusFilter, setStatusFilter] = useState<UsersStatusFilter>(() => getUsersPageSessionState(queryClient).statusFilter);

  useEffect(() => {
    updateUsersPageSessionState(queryClient, { search, roleFilter, statusFilter });
  }, [queryClient, roleFilter, search, statusFilter]);

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
