import { apiClient } from "../../shared/api";
import { supabase } from "../../shared/api/supabase";
import type { UserProfile, UserRole } from "../../entities/user/types";

type UserAdminAction =
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

async function callUserAdminAction(payload: UserAdminAction) {
  const { error } = await supabase.functions.invoke("user-admin", {
    body: payload,
  });

  if (error) {
    throw error;
  }
}

export async function getAllUsers(): Promise<UserProfile[]> {
  const { data, error } = await apiClient
    .from("profiles")
    .select("id, name, email, role, is_disabled, created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as UserProfile[];
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
