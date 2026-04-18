import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { DashboardViewMode, ListRefreshNavigationState } from "../types";

type UseDashboardListRefreshOptions = {
  isAuthLoading: boolean;
  isListFetching: boolean;
  listUpdatedAt: number;
  reloadForms: () => unknown;
  userId?: string;
  viewMode: DashboardViewMode;
};

export function useDashboardListRefresh({
  isAuthLoading,
  isListFetching,
  listUpdatedAt,
  reloadForms,
  userId,
  viewMode,
}: UseDashboardListRefreshOptions) {
  const location = useLocation();
  const navigate = useNavigate();
  const isListFetchingRef = useRef(isListFetching);
  const listUpdatedAtRef = useRef(listUpdatedAt);

  useEffect(() => {
    isListFetchingRef.current = isListFetching;
  }, [isListFetching]);

  useEffect(() => {
    listUpdatedAtRef.current = listUpdatedAt;
  }, [listUpdatedAt]);

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

    const requestedAt = listUpdatedAtRef.current;
    const timeoutId = window.setTimeout(() => {
      if (!isListFetchingRef.current && listUpdatedAtRef.current === requestedAt) {
        void reloadForms();
      }
    }, 25);

    navigate(location.pathname, { replace: true, state: null });

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    isAuthLoading,
    isListFetching,
    listUpdatedAt,
    location.pathname,
    location.state,
    navigate,
    reloadForms,
    userId,
    viewMode,
  ]);
}
