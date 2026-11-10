import { useNavigationListRefresh } from "../../../shared/lib/useNavigationListRefresh";
import type { DashboardViewMode } from "../types";

type Options = {
  isAuthLoading: boolean;
  isListFetching: boolean;
  listUpdatedAt: number;
  reloadForms: () => unknown;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardListRefresh(options: Options) {
  useNavigationListRefresh({
    ready: !options.isAuthLoading && (options.viewMode !== "mine" || Boolean(options.userId)),
    isFetching: options.isListFetching,
    updatedAt: options.listUpdatedAt,
    reload: options.reloadForms,
  });
}
