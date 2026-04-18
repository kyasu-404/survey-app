import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ListRefreshNavigationState, TemplatesSection } from "../types";

type UseTemplatesListRefreshOptions = {
  isAuthLoading: boolean;
  isListFetching: boolean;
  listUpdatedAt: number;
  reloadTemplates: () => unknown;
  section: TemplatesSection;
  userId?: string;
};

export function useTemplatesListRefresh({
  isAuthLoading,
  isListFetching,
  listUpdatedAt,
  reloadTemplates,
  section,
  userId,
}: UseTemplatesListRefreshOptions) {
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

    if (isAuthLoading || (section === "mine" && !userId)) {
      return;
    }

    const requestedAt = listUpdatedAtRef.current;
    const timeoutId = window.setTimeout(() => {
      if (!isListFetchingRef.current && listUpdatedAtRef.current === requestedAt) {
        void reloadTemplates();
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
    reloadTemplates,
    section,
    userId,
  ]);
}
