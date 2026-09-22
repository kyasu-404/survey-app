import type { FormsCursor } from "../../../entities/survey/types";
import { createBatchedFormsQuery, getFormsNextCursor } from "../../../shared/lib/batchedInfiniteQuery";
import { useEffect, useMemo } from "react";
import { supabaseClient } from "../../../shared/api";
import { useToast } from "../../../app/providers/ToastProvider";
import { createQueryRefreshScheduler } from "../../../shared/lib/queryRefresh";
import { createRealtimeRecovery } from "../../../shared/lib/realtimeRecovery";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getTemplateFormsPage } from "../../../entities/survey/api/surveysApi";
import { getTemplateFormsQueryKey } from "../../../entities/survey/model/queryKeys";
import { TEMPLATE_FORM_TYPE, isTemplateForm } from "../../../entities/survey/model/surveyModel";
import { TEMPLATE_PAGE_SIZE } from "../templatesPageConstants";
import type { TemplatesSection } from "../types";

type UseTemplatesDataOptions = {
  isAuthLoading: boolean;
  section: TemplatesSection;
  userId?: string;
};

export function useTemplatesData({ isAuthLoading, section, userId }: UseTemplatesDataOptions) {
  const { showToast } = useToast();
  const templatesQueryKey = useMemo(
    () =>
      getTemplateFormsQueryKey({
        section,
        pageSize: TEMPLATE_PAGE_SIZE,
        userId: userId ?? null,
      }),
    [section, userId],
  );

  const queryClient = useQueryClient();
  useEffect(() => {
    if (isAuthLoading || !userId) return;
    const refresh = createQueryRefreshScheduler(queryClient, "templates realtime", 300);
    const reload = () => refresh.schedule([{ queryKey: templatesQueryKey }]);
    const recovery = createRealtimeRecovery(reload, showToast);
    const channel = supabaseClient.channel(`templates:${userId}:${section}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "forms" }, payload => {
        // DELETE carries only the primary key; visibility changes may remove a card.
        if (payload.eventType === "DELETE" || payload.new.form_type === TEMPLATE_FORM_TYPE || ("form_type" in payload.old && payload.old.form_type === TEMPLATE_FORM_TYPE)) reload();
      })
      .subscribe(recovery.status);
    return () => { recovery.dispose(); refresh.dispose(); void supabaseClient.removeChannel(channel); };
  }, [isAuthLoading, userId, section, templatesQueryKey, queryClient, showToast]);
  const fetchList = useMemo(() => createBatchedFormsQuery(
    queryClient, templatesQueryKey, TEMPLATE_PAGE_SIZE,
    (request) => getTemplateFormsPage({
        ...request,
        filters:
          section === "mine"
            ? {
                authorId: userId,
                formType: TEMPLATE_FORM_TYPE,
              }
            : {
                formType: TEMPLATE_FORM_TYPE,
                isPublic: true,
              },
      }),
  ), [queryClient, templatesQueryKey, section, userId]);

  const query = useInfiniteQuery({
    queryKey: templatesQueryKey,
    initialPageParam: null as FormsCursor | null,
    queryFn: fetchList,
    getNextPageParam: getFormsNextCursor,
    enabled: !isAuthLoading && (section === "public" || Boolean(userId)),
    retry: 1,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const templates = useMemo(() => {
    const templateForms = (query.data?.pages.flatMap((page) => page.items) ?? []).filter((form) => isTemplateForm(form));
    return section === "public" ? templateForms.filter((form) => form.is_public) : templateForms;
  }, [query.data, section]);

  return {
    hasMoreTemplates: Boolean(query.hasNextPage),
    isInitialTemplatesLoading: query.isLoading && templates.length === 0,
    isRefreshingTemplates: query.isFetching && templates.length > 0 && !query.isFetchingNextPage,
    templates,
    templatesError: query.error,
    templatesUpdatedAt: query.dataUpdatedAt,
    isFetchingNextTemplatesPage: query.isFetchingNextPage,
    loadNextTemplatesPage: query.fetchNextPage,
    reloadTemplates: query.refetch,
  };
}
