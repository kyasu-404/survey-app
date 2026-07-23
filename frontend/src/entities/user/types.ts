export type UserRole = "admin" | "user";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_disabled: boolean;
  created_at?: string;
};
