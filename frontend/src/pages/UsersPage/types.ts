import type { UserRole } from "../../entities/user/types";

export type NewUserForm = {
  name: string;
  email: string;
  password: string;
  role: UserRole;
};

export type PasswordModalState = {
  userId: string;
  title: string;
  password: string;
  isOwnPassword: boolean;
};

export type DeleteUserModalState = {
  userId: string;
  userName: string;
};

export type RoleChangeModalState = {
  userId: string;
  userName: string;
  currentRole: UserRole;
  nextRole: UserRole;
};

export type UsersRoleFilter = UserRole | "all";
export type UsersStatusFilter = "all" | "active" | "disabled";
