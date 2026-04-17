import { useQuery } from "@tanstack/react-query";
import { getFormById } from "../../../entities/survey/api/surveysApi";
import { getFormQueryKey } from "../../../entities/survey/model/queryKeys";
import type { SurveyFormSummary } from "../../../entities/survey/types";

export function useTemplatePreview(previewTemplateCard: SurveyFormSummary | null) {
  return useQuery({
    queryKey: getFormQueryKey(previewTemplateCard?.id),
    queryFn: ({ signal }) => getFormById(previewTemplateCard!.id, { signal }),
    enabled: Boolean(previewTemplateCard?.id),
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });
}
