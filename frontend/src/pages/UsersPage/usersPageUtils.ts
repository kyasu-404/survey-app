import type { UserProfile } from "../../entities/user/types";

export function getUserDisplayName(profile: UserProfile) {
  return profile.name || profile.email;
}

export function getStatusLabel(profile: UserProfile) {
  return profile.is_disabled ? "Отключён" : "Активен";
}
