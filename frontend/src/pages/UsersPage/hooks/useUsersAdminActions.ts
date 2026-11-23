import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createUser,
  deleteUser,
  setUserDisabled,
  updateUserPassword,
  updateUserRole,
} from "../../../features/users/api";
import { useToast } from "../../../app/providers/ToastProvider";
import { USERS_QUERY_ROOT } from "../../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../../shared/lib/error";
import { getNewPasswordError } from "../../../shared/lib/passwordPolicy";
import { scheduleQueryInvalidation } from "../../../shared/lib/queryRefresh";
import type { DeleteUserModalState, NewUserForm, PasswordModalState, RoleChangeModalState } from "../types";
import { EMPTY_NEW_USER, getUsersPageSessionState, updateUsersPageSessionState } from "../usersPageSessionState";

export function useUsersAdminActions() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [newUser, setNewUser] = useState<NewUserForm>(() => getUsersPageSessionState(queryClient).newUser);
  const [pendingStatusUserId, setPendingStatusUserId] = useState<string | null>(null);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [deleteUserModal, setDeleteUserModal] = useState<DeleteUserModalState | null>(null);
  const [roleChangeModal, setRoleChangeModal] = useState<RoleChangeModalState | null>(null);
  const inFlightOpsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    updateUsersPageSessionState(queryClient, { newUser });
  }, [newUser, queryClient]);

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setNewUser(EMPTY_NEW_USER);
      setIsCreateUserOpen(false);
      showToast("Пользователь создан", "success");
      scheduleQueryInvalidation(queryClient, "create user", [{ queryKey: USERS_QUERY_ROOT }]);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось создать пользователя"), "error");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      showToast("Пользователь удалён", "success");
      scheduleQueryInvalidation(queryClient, "delete user", [{ queryKey: USERS_QUERY_ROOT }]);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось удалить пользователя"), "error");
    },
  });

  const setUserDisabledMutation = useMutation({
    mutationFn: ({ userId, disabled }: { userId: string; disabled: boolean }) => setUserDisabled(userId, disabled),
    onMutate: ({ userId }) => {
      setPendingStatusUserId(userId);
    },
    onSuccess: (_data, variables) => {
      showToast(variables.disabled ? "Пользователь отключён" : "Пользователь включён", "success");
      scheduleQueryInvalidation(queryClient, "toggle user disabled", [{ queryKey: USERS_QUERY_ROOT }]);
    },
    onSettled: () => {
      setPendingStatusUserId(null);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось изменить статус пользователя"), "error");
    },
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: Pick<RoleChangeModalState, "userId"> & { role: RoleChangeModalState["nextRole"] }) =>
      updateUserRole(userId, role),
    onSuccess: () => {
      setRoleChangeModal(null);
      showToast("Роль пользователя обновлена", "success");
      scheduleQueryInvalidation(queryClient, "update user role", [{ queryKey: USERS_QUERY_ROOT }]);
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось изменить роль пользователя"), "error");
    },
  });

  const updateUserPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) => updateUserPassword(userId, password),
    onSuccess: () => {
      setPasswordModal(null);
      showToast("Пароль пользователя обновлён", "success");
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось обновить пароль пользователя"), "error");
    },
  });

  const newPasswordError = getNewPasswordError(newUser.password);
  const modalPasswordError = passwordModal ? getNewPasswordError(passwordModal.password) : null;

  const onCreateUser = async () => {
    if (inFlightOpsRef.current.has("create")) {
      return;
    }

    if (!newUser.name.trim()) {
      showToast("Укажите имя", "error");
      return;
    }

    if (newPasswordError) {
      showToast(newPasswordError, "error");
      return;
    }

    inFlightOpsRef.current.add("create");
    try {
      await createUserMutation.mutateAsync({
        ...newUser,
        name: newUser.name.trim(),
        email: newUser.email.trim(),
      });
    } catch {
      // onError reports the error; retain the dialog and draft for correction.
    } finally {
      inFlightOpsRef.current.delete("create");
    }
  };

  const openPasswordModal = (userId: string, title: string) => {
    setPasswordModal({
      userId,
      title,
      password: "",
    });
  };

  const updatePasswordModalValue = (password: string) => {
    setPasswordModal((current) => (current ? { ...current, password } : current));
  };

  const onChangePassword = async () => {
    if (!passwordModal || inFlightOpsRef.current.has("password")) {
      return;
    }

    if (modalPasswordError) {
      showToast(modalPasswordError, "error");
      return;
    }

    inFlightOpsRef.current.add("password");
    try {
      await updateUserPasswordMutation.mutateAsync({
        userId: passwordModal.userId,
        password: passwordModal.password,
      });
    } catch {
      // onError reports the error; retain the modal for retry.
    } finally {
      inFlightOpsRef.current.delete("password");
    }
  };

  const onDeleteUser = async () => {
    if (!deleteUserModal || inFlightOpsRef.current.has("delete")) {
      return;
    }

    inFlightOpsRef.current.add("delete");
    try {
      await deleteUserMutation.mutateAsync(deleteUserModal.userId);
      setDeleteUserModal(null);
    } catch {
      // onError reports the error; retain the confirmation modal.
    } finally {
      inFlightOpsRef.current.delete("delete");
    }
  };

  const onToggleUserDisabled = async (userId: string, disabled: boolean) => {
    const key = `status:${userId}`;
    if (inFlightOpsRef.current.has(key)) {
      return;
    }

    inFlightOpsRef.current.add(key);
    try {
      await setUserDisabledMutation.mutateAsync({ userId, disabled });
    } catch {
      // onError reports the error.
    } finally {
      inFlightOpsRef.current.delete(key);
    }
  };

  const onChangeRole = async () => {
    if (!roleChangeModal || inFlightOpsRef.current.has("role")) {
      return;
    }

    inFlightOpsRef.current.add("role");
    try {
      await updateUserRoleMutation.mutateAsync({
        userId: roleChangeModal.userId,
        role: roleChangeModal.nextRole,
      });
    } catch {
      // onError reports the error; retain the modal.
    } finally {
      inFlightOpsRef.current.delete("role");
    }
  };

  return {
    isCreateUserOpen,
    setIsCreateUserOpen,
    createUserPending: createUserMutation.isPending,
    deleteUserModal,
    deleteUserPending: deleteUserMutation.isPending,
    modalPasswordError,
    newPasswordError,
    isStatusChangePending: setUserDisabledMutation.isPending,
    newUser,
    onChangePassword,
    onChangeRole,
    onCreateUser,
    onDeleteUser,
    onToggleUserDisabled,
    openPasswordModal,
    passwordModal,
    pendingStatusUserId,
    roleChangeModal,
    roleChangePending: updateUserRoleMutation.isPending,
    setDeleteUserModal,
    setNewUser,
    setPasswordModal,
    setRoleChangeModal,
    updatePasswordModalValue,
    updatePasswordPending: updateUserPasswordMutation.isPending,
  };
}
