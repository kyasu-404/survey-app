import { apiClient } from "../../shared/api";

export async function login(email: string, password: string) {
  const { error } = await apiClient.auth.login(email, password);
  if (error) throw error;
}

export async function register(email: string, password: string) {
  const { error } = await apiClient.auth.register(email, password);
  if (error) throw error;
}

export async function logout() {
  await apiClient.auth.logout();
}
