import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
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
  const [newUser, setNewUserState] = useState<NewUserForm>(() => getUsersPageSessionState(queryClient).newUser);
  const [pendingStatusUserId, setPendingStatusUserId] = useState<string | null>(null);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [deleteUserModal, setDeleteUserModal] = useState<DeleteUserModalState | null>(null);
  const [roleChangeModal, setRoleChangeModal] = useState<RoleChangeModalState | null>(null);

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
    if (!newUser.name.trim()) {
      showToast("Укажите имя", "error");
      return;
    }

    if (newPasswordError) {
      showToast(newPasswordError, "error");
      return;
    }

    try {
      await createUserMutation.mutateAsync({
        ...newUser,
        name: newUser.name.trim(),
        email: newUser.email.trim(),
      });
    } catch {
      // onError reports the error; retain the dialog and draft for correction.
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

  const onChangePassword = () => {
    if (!passwordModal) {
      return;
    }

    if (modalPasswordError) {
      showToast(modalPasswordError, "error");
      return;
    }

    updateUserPasswordMutation.mutate({
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

  const onChangeRole = async () => {
    if (!roleChangeModal) {
      return;
    }

    await updateUserRoleMutation.mutateAsync({
      userId: roleChangeModal.userId,
      role: roleChangeModal.nextRole,
    });
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
