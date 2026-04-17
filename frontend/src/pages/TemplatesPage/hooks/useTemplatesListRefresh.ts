import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ListRefreshNavigationState, TemplatesSection } from "../types";

type UseTemplatesListRefreshOptions = {
  isAuthLoading: boolean;
  reloadTemplates: () => unknown;
  section: TemplatesSection;
  userId?: string;
};

export function useTemplatesListRefresh({
  isAuthLoading,
  reloadTemplates,
  section,
  userId,
}: UseTemplatesListRefreshOptions) {
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

    if (isAuthLoading || (section === "mine" && !userId)) {
      return;
    }

    void reloadTemplates();
    navigate(location.pathname, { replace: true, state: null });
  }, [isAuthLoading, location.pathname, location.state, navigate, reloadTemplates, section, userId]);
}
