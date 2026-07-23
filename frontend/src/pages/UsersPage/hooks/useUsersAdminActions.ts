import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createUser,
  deleteUser,
  setUserDisabled,
  updateMyPassword,
  updateUserPassword,
} from "../../../features/users/api";
import { useToast } from "../../../app/providers/ToastProvider";
import { USERS_QUERY_ROOT } from "../../../entities/survey/model/queryKeys";
import { getErrorMessage } from "../../../shared/lib/error";
import { scheduleQueryInvalidation } from "../../../shared/lib/queryRefresh";
import type { DeleteUserModalState, NewUserForm, PasswordModalState } from "../types";
import { EMPTY_NEW_USER, getUsersPageSessionState, updateUsersPageSessionState } from "../usersPageSessionState";

export function useUsersAdminActions() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [newUser, setNewUserState] = useState<NewUserForm>(() => getUsersPageSessionState(queryClient).newUser);
  const [pendingStatusUserId, setPendingStatusUserId] = useState<string | null>(null);
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [deleteUserModal, setDeleteUserModal] = useState<DeleteUserModalState | null>(null);

  const setNewUser = useCallback<Dispatch<SetStateAction<NewUserForm>>>(
    (value) => {
      setNewUserState((currentValue) => {
        const nextValue = typeof value === "function" ? value(currentValue) : value;
        updateUsersPageSessionState(queryClient, { newUser: nextValue });

        return nextValue;
      });
    },
    [queryClient],
  );

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      setNewUser(EMPTY_NEW_USER);
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

  const updatePasswordMutation = useMutation({
    mutationFn: updateMyPassword,
    onSuccess: () => {
      setPasswordModal(null);
      showToast("Пароль обновлён", "success");
    },
    onError: (error) => {
      showToast(getErrorMessage(error, "Не удалось обновить пароль"), "error");
    },
  });

  const isPasswordValid = useMemo(() => newUser.password.length >= 8, [newUser.password.length]);
  const isModalPasswordValid = useMemo(() => (passwordModal?.password.length ?? 0) >= 8, [passwordModal?.password.length]);

  const onCreateUser = async () => {
    if (!newUser.name.trim()) {
      showToast("Укажите имя", "error");
      return;
    }

    if (!isPasswordValid) {
      showToast("Пароль должен быть не короче 8 символов", "error");
      return;
    }

    await createUserMutation.mutateAsync({
      ...newUser,
      name: newUser.name.trim(),
      email: newUser.email.trim(),
    });
  };

  const openPasswordModal = (userId: string, title: string, isOwnPassword: boolean) => {
    setPasswordModal({
      userId,
      title,
      password: "",
      isOwnPassword,
    });
  };

  const updatePasswordModalValue = (password: string) => {
    setPasswordModal((current) => (current ? { ...current, password } : current));
  };

  const onChangePassword = async () => {
    if (!passwordModal) {
      return;
    }

    if (!isModalPasswordValid) {
      showToast("Пароль должен быть не короче 8 символов", "error");
      return;
    }

    if (passwordModal.isOwnPassword) {
      await updatePasswordMutation.mutateAsync(passwordModal.password);
      return;
    }

    await updateUserPasswordMutation.mutateAsync({
      userId: passwordModal.userId,
      password: passwordModal.password,
    });
  };

  const onDeleteUser = async () => {
    if (!deleteUserModal) {
      return;
    }

    await deleteUserMutation.mutateAsync(deleteUserModal.userId);
    setDeleteUserModal(null);
  };

  const onToggleUserDisabled = async (userId: string, disabled: boolean) => {
    await setUserDisabledMutation.mutateAsync({ userId, disabled });
  };

  return {
    createUserPending: createUserMutation.isPending,
    deleteUserModal,
    deleteUserPending: deleteUserMutation.isPending,
    isModalPasswordValid,
    isPasswordValid,
    isStatusChangePending: setUserDisabledMutation.isPending,
    newUser,
    onChangePassword,
    onCreateUser,
    onDeleteUser,
    onToggleUserDisabled,
    openPasswordModal,
    passwordModal,
    pendingStatusUserId,
    setDeleteUserModal,
    setNewUser,
    setPasswordModal,
    updatePasswordModalValue,
    updatePasswordPending: updatePasswordMutation.isPending || updateUserPasswordMutation.isPending,
  };
}
