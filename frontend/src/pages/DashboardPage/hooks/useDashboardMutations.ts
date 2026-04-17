import { useMutation } from "@tanstack/react-query";
import {
  changeFormStatus,
  cloneForm,
  removeForm,
  renameForm,
  setFormDeadline,
  setFormResponseLimit,
} from "../../../entities/survey/api/surveysApi";
import type { SurveyForm } from "../../../entities/survey/types";

export function useDashboardMutations() {
  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameForm(id, title),
  });
  const removeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => removeForm(id),
  });
  const duplicateMutation = useMutation({
    mutationFn: ({ form, authorId }: { form: SurveyForm; authorId: string }) => cloneForm(form, authorId),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) => changeFormStatus(id, isPublic),
  });
  const deadlineMutation = useMutation({
    mutationFn: ({ id, deadlineAt }: { id: string; deadlineAt: string | null }) => setFormDeadline(id, deadlineAt),
  });
  const responseLimitMutation = useMutation({
    mutationFn: ({ id, maxResponses }: { id: string; maxResponses: number | null }) =>
      setFormResponseLimit(id, maxResponses),
  });

  return {
    deadlineMutation,
    duplicateMutation,
    removeMutation,
    renameMutation,
    responseLimitMutation,
    statusMutation,
  };
}
