import { useNavigationListRefresh } from "../../../shared/lib/useNavigationListRefresh";
import type { TemplatesSection } from "../types";

type Options = {
  isAuthLoading: boolean;
  isListFetching: boolean;
  listUpdatedAt: number;
  reloadTemplates: () => unknown;
  userId?: string;
  section: TemplatesSection;
};

export function useTemplatesListRefresh(options: Options) {
  useNavigationListRefresh({
    ready: !options.isAuthLoading && (options.section !== "mine" || Boolean(options.userId)),
    isFetching: options.isListFetching,
    updatedAt: options.listUpdatedAt,
    reload: options.reloadTemplates,
  });
}
