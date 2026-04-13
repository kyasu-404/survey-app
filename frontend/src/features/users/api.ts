import { supabase } from "../../shared/api/supabase";
import { apiClient } from "../../shared/api";
import type { UserProfile, UserRole } from "../../entities/user/types";
import { runRequest } from "../../shared/api/request";

type UserAdminAction =
  | {
      action: "list";
    }
  | {
      action: "create";
      name: string;
      email: string;
      password: string;
      role: UserRole;
    }
  | {
      action: "delete";
      userId: string;
    }
  | {
      action: "updatePassword";
      userId: string;
      password: string;
    }
  | {
      action: "setDisabled";
      userId: string;
      disabled: boolean;
    }
  | {
      action: "updateRole";
      userId: string;
      role: UserRole;
    };

async function getFunctionErrorMessage(error: unknown, response?: Response) {
  const errorResponse = response ?? (error instanceof Error && "context" in error ? error.context : undefined);

  if (errorResponse instanceof Response) {
    const contentType = errorResponse.headers.get("Content-Type") ?? "";

    if (contentType.includes("application/json")) {
      const payload = await errorResponse.clone().json().catch(() => null);
      const message = typeof payload?.error === "string" ? payload.error.trim() : "";

      if (message) {
        return message;
      }
    }
  }

  return error instanceof Error && error.message.trim() ? error.message : "Не удалось выполнить действие пользователя";
}

async function callUserAdminAction<TData = null>(payload: UserAdminAction): Promise<TData> {
  const {
    data: { session },
  } = await runRequest("auth.getSession", () => supabase.auth.getSession());
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");
  }

  const { data, error, response } = await runRequest(
    "functions.user-admin",
    () =>
      supabase.functions.invoke<TData>("user-admin", {
        body: payload,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    { context: { action: payload.action } },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error, response));
  }

  return data;
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const data = await callUserAdminAction<{ users?: UserProfile[] }>({
    action: "list",
  });

  return data?.users ?? [];
}

export async function createUser(payload: { name: string; email: string; password: string; role: UserRole }) {
  await callUserAdminAction({
    action: "create",
    name: payload.name,
    email: payload.email,
    password: payload.password,
    role: payload.role,
  });
}

export async function deleteUser(userId: string) {
  await callUserAdminAction({
    action: "delete",
    userId,
  });
}

export async function setUserDisabled(userId: string, disabled: boolean) {
  await callUserAdminAction({
    action: "setDisabled",
    userId,
    disabled,
  });
}

export async function updateUserRole(userId: string, role: UserRole) {
  await callUserAdminAction({
    action: "updateRole",
    userId,
    role,
  });
}

export async function updateUserPassword(userId: string, password: string) {
  await callUserAdminAction({
    action: "updatePassword",
    userId,
    password,
  });
}

export async function updateMyPassword(password: string) {
  const { error } = await runRequest(
    "auth.updateCurrentUserPassword",
    () => apiClient.auth.updateCurrentUserPassword(password),
  );
  if (error) throw error;
}
