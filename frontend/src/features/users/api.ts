import { apiClient } from "../../shared/api";
import type { UserProfile, UserRole } from "../../entities/user/types";

export async function getAllUsers(): Promise<UserProfile[]> {
  const { data, error } = await apiClient
    .from("profiles")
    .select("id, name, email, role, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as UserProfile[];
}

export async function createUser(payload: { name: string; email: string; password: string; role: UserRole }) {
  const { data, error } = await apiClient.auth.register(payload.email, payload.password, {
    name: payload.name,
    role: payload.role,
  });
  if (error) throw error;

  const userId = data.user?.id;
  if (!userId) {
    throw new Error("Не удалось создать пользователя");
  }
}

export async function updateMyPassword(password: string) {
  const { error } = await apiClient.auth.updateCurrentUserPassword(password);
  if (error) throw error;
}
