export type UserRole = "admin" | "user";

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at?: string;
};
