import { supabase } from "../../shared/api/supabase";
import { apiClient } from "../../shared/api";
import type { UserProfile, UserRole } from "../../entities/user/types";

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
    };

async function callUserAdminAction<TData = null>(payload: UserAdminAction): Promise<TData> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error("Сессия авторизации не готова. Попробуйте обновить страницу.");
  }

  const { data, error } = await supabase.functions.invoke<TData>("user-admin", {
    body: payload,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    throw error;
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

export async function updateUserPassword(userId: string, password: string) {
  await callUserAdminAction({
    action: "updatePassword",
    userId,
    password,
  });
}

export async function updateMyPassword(password: string) {
  const { error } = await apiClient.auth.updateCurrentUserPassword(password);
  if (error) throw error;
}
