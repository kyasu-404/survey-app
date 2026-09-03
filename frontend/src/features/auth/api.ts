import { apiClient } from "../../shared/api";

export async function login(email: string, password: string) {
  const { data, error } = await apiClient.auth.login(email, password);
  if (error) throw error;

  const metadataName = typeof data.user?.user_metadata?.name === "string"
    ? data.user.user_metadata.name.trim()
    : "";
  if (!data.user?.id) return metadataName;

  try {
    const { data: profile } = await apiClient
      .from("profiles")
      .select("name")
      .eq("id", data.user.id)
      .maybeSingle();
    const profileName = typeof profile?.name === "string" ? profile.name.trim() : "";
    return profileName || metadataName;
  } catch {
    return metadataName;
  }
}

export async function register(email: string, password: string) {
  const { error } = await apiClient.auth.register(email, password, { role: "user" });
  if (error) throw error;
}

export async function logout() {
  const { error } = await apiClient.auth.logout();
  if (error) throw error;
}
