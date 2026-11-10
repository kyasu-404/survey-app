import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type Options = {
  ready: boolean;
  isFetching: boolean;
  updatedAt: number;
  reload: () => unknown;
};

export function useNavigationListRefresh({ ready, isFetching, updatedAt, reload }: Options) {
  const location = useLocation();
  const navigate = useNavigate();
  const latest = useRef({ isFetching, updatedAt, reload });
  useEffect(() => {
    latest.current = { isFetching, updatedAt, reload };
  }, [isFetching, updatedAt, reload]);

  useEffect(() => {
    if (!ready || !location.state || typeof location.state !== "object" || location.state.refreshList !== true) {
      return;
    }

    const requestedAt = latest.current.updatedAt;
    const timeoutId = window.setTimeout(() => {
      if (!latest.current.isFetching && latest.current.updatedAt === requestedAt) {
        void latest.current.reload();
      }
      // Consuming the navigation flag earlier would cancel this effect's timer.
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true,
        state: null,
      });
    }, 25);

    return () => window.clearTimeout(timeoutId);
  }, [ready, location.pathname, location.search, location.hash, location.state, navigate]);
}
