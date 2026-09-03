import type { QueryClient } from "@tanstack/react-query";
import type { NewUserForm, UsersRoleFilter, UsersStatusFilter } from "./types";

export const EMPTY_NEW_USER: NewUserForm = {
  name: "",
  email: "",
  password: "",
  role: "user",
};

type UsersPageSessionState = {
  newUser: NewUserForm;
  roleFilter: UsersRoleFilter;
  search: string;
  statusFilter: UsersStatusFilter;
};

const DEFAULT_USERS_PAGE_SESSION_STATE: UsersPageSessionState = {
  newUser: EMPTY_NEW_USER,
  roleFilter: "all",
  search: "",
  statusFilter: "all",
};

const usersPageSessionStateByClient = new WeakMap<QueryClient, UsersPageSessionState>();

function cloneNewUser(newUser: NewUserForm): NewUserForm {
  // Passwords are short-lived credentials, not navigation state.  Keeping one
  // in the module-level cache would expose it to the next authenticated user
  // when a shared browser session changes accounts.
  return { ...newUser, password: "" };
}

function cloneUsersPageSessionState(state: UsersPageSessionState): UsersPageSessionState {
  return {
    ...state,
    newUser: cloneNewUser(state.newUser),
  };
}

export function getUsersPageSessionState(queryClient: QueryClient) {
  const existingState = usersPageSessionStateByClient.get(queryClient);

  if (existingState) {
    return cloneUsersPageSessionState(existingState);
  }

  const initialState = cloneUsersPageSessionState(DEFAULT_USERS_PAGE_SESSION_STATE);
  usersPageSessionStateByClient.set(queryClient, initialState);

  return cloneUsersPageSessionState(initialState);
}

export function updateUsersPageSessionState(queryClient: QueryClient, updates: Partial<UsersPageSessionState>) {
  const currentState = usersPageSessionStateByClient.get(queryClient) ?? cloneUsersPageSessionState(DEFAULT_USERS_PAGE_SESSION_STATE);
  const nextState: UsersPageSessionState = {
    ...currentState,
    ...updates,
    newUser: updates.newUser ? cloneNewUser(updates.newUser) : cloneNewUser(currentState.newUser),
  };

  usersPageSessionStateByClient.set(queryClient, nextState);
}

export function clearUsersPageSessionState(queryClient: QueryClient) {
  usersPageSessionStateByClient.delete(queryClient);
}
