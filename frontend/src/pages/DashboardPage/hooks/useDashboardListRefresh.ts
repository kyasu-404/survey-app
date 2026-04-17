import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DashboardViewMode, ListRefreshNavigationState } from "../types";

type UseDashboardListRefreshOptions = {
  isAuthLoading: boolean;
  reloadForms: () => unknown;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardListRefresh({ isAuthLoading, reloadForms, userId, viewMode }: UseDashboardListRefreshOptions) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const shouldRefreshList =
      location.state &&
      typeof location.state === "object" &&
      (location.state as ListRefreshNavigationState).refreshList === true;

    if (!shouldRefreshList) {
      return;
    }

    if (isAuthLoading || (viewMode === "mine" && !userId)) {
      return;
    }

    void reloadForms();
    navigate(location.pathname, { replace: true, state: null });
  }, [isAuthLoading, location.pathname, location.state, navigate, reloadForms, userId, viewMode]);
}
