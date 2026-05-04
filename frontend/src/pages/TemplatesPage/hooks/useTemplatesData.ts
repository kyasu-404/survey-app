import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
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
  const templatesQueryKey = useMemo(
    () =>
      getTemplateFormsQueryKey({
        section,
        pageSize: TEMPLATE_PAGE_SIZE,
        userId: userId ?? null,
      }),
    [section, userId],
  );

  const query = useInfiniteQuery({
    queryKey: templatesQueryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getTemplateFormsPage({
        page: pageParam,
        pageSize: TEMPLATE_PAGE_SIZE,
        signal,
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
    getNextPageParam: (lastPage, allPages) =>
      lastPage.items.length === TEMPLATE_PAGE_SIZE ? allPages.length : undefined,
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
