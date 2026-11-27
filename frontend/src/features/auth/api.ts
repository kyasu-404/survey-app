import { apiClient } from "../../shared/api";
import { isTerminalSessionError } from "../../shared/api/session";
import { clearSurveyBuilderDraftsForUser } from "../../shared/lib/builderDraftStorage";
import { runRequest } from "../../shared/api/request";

export async function login(email: string, password: string) {
  const normalizedEmail = email.trim();
  const { data, error } = await runRequest("auth.login", () =>
    apiClient.auth.login(normalizedEmail, password));
  if (error) throw error;

  const metadataName = typeof data.user?.user_metadata?.name === "string"
    ? data.user.user_metadata.name.trim()
    : "";
  const userId = data.user?.id;
  if (!userId) throw new Error("Сервер не вернул пользователя после входа.");

  let profile: { name?: unknown; is_disabled?: unknown } | null = null;
  try {
    const result = await runRequest(
      "profiles.loadDisplayName",
      () =>
        apiClient
          .from("profiles")
          .select("name, is_disabled")
          .eq("id", data.user.id)
          .maybeSingle(),
      { timeoutMs: 5_000, context: { userId: data.user.id } },
    );
    profile = result.data ?? null;
  } catch (error) {
    if (isTerminalSessionError(error)) throw error;
    return { displayName: metadataName, userId };
  }

  if (profile?.is_disabled === true) {
    try {
      await apiClient.auth.logout(userId, "local");
    } catch {
      // Best-effort sign-out if the account is already marked disabled.
    }
    throw Object.assign(new Error("User is banned"), { code: "user_banned", status: 403 });
  }

  const profileName = typeof profile?.name === "string" ? profile.name.trim() : "";
  return { displayName: profileName || metadataName, userId };
}

export async function register(email: string, password: string) {
  const { error } = await apiClient.auth.register(email, password, { role: "user" });
  if (error) throw error;
}

export async function logout(userId?: string) {
  const { error } = await apiClient.auth.logout(userId);
  if (error) throw error;
  if (userId) clearSurveyBuilderDraftsForUser(userId);
}

export async function changeOwnPassword(currentPassword: string, password: string) {
  const { error } = await runRequest("auth.updateCurrentUserPassword", () =>
    apiClient.auth.updateCurrentUserPassword(currentPassword, password));
  if (error) throw error;
}
