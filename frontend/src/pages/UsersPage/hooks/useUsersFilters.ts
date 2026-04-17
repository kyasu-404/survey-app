import { useMemo, useState } from "react";
import type { UserProfile } from "../../../entities/user/types";
import type { UsersRoleFilter, UsersStatusFilter } from "../types";

export function useUsersFilters(users: UserProfile[]) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UsersRoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<UsersStatusFilter>("all");

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
