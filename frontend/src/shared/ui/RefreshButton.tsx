import { useEffect, useRef, useState } from "react";
import refreshIcon from "../../img/refresh.png";
import { InlineSpinner } from "./InlineSpinner";

const UPDATED_STATE_DURATION_MS = 1500;

function formatLastUpdatedLabel(lastUpdatedAt: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(lastUpdatedAt);
}

type RefreshButtonProps = {
  disabled?: boolean;
  isRefreshing: boolean;
  lastUpdatedAt?: number;
  onClick: () => void;
};

export function RefreshButton({
  disabled = false,
  isRefreshing,
  lastUpdatedAt = 0,
  onClick,
}: RefreshButtonProps) {
  const [isRecentlyUpdated, setIsRecentlyUpdated] = useState(false);
  const previousIsRefreshingRef = useRef(isRefreshing);
  const previousLastUpdatedAtRef = useRef(lastUpdatedAt);
  const awaitingManualRefreshRef = useRef(false);
  const updateTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const previousIsRefreshing = previousIsRefreshingRef.current;
    const previousLastUpdatedAt = previousLastUpdatedAtRef.current;

    if (
      awaitingManualRefreshRef.current &&
      previousIsRefreshing &&
      !isRefreshing &&
      lastUpdatedAt > 0 &&
      lastUpdatedAt !== previousLastUpdatedAt
    ) {
      awaitingManualRefreshRef.current = false;
      setIsRecentlyUpdated(true);

      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }

      updateTimerRef.current = window.setTimeout(() => {
        setIsRecentlyUpdated(false);
        updateTimerRef.current = null;
      }, UPDATED_STATE_DURATION_MS);
    }

    previousIsRefreshingRef.current = isRefreshing;
    previousLastUpdatedAtRef.current = lastUpdatedAt;
  }, [isRefreshing, lastUpdatedAt]);

  useEffect(() => {
    return () => {
      if (updateTimerRef.current !== null) {
        window.clearTimeout(updateTimerRef.current);
      }
    };
  }, []);

  const buttonLabel = isRefreshing ? "Обновляется..." : isRecentlyUpdated ? "Обновлено" : "Обновить";
  const lastUpdatedLabel = lastUpdatedAt > 0 ? `Обновлено ${formatLastUpdatedLabel(lastUpdatedAt)}` : null;

  return (
    <div className="dashboard-refresh-control">
      {lastUpdatedLabel ? <p className="dashboard-refresh-meta">{lastUpdatedLabel}</p> : null}
      <button
        type="button"
        className="dashboard-refresh-button"
        onClick={() => {
          awaitingManualRefreshRef.current = true;
          setIsRecentlyUpdated(false);
          onClick();
        }}
        disabled={disabled}
      >
        {isRefreshing ? (
          <InlineSpinner />
        ) : (
          <img src={refreshIcon} alt="" aria-hidden="true" className="toolbar-icon" />
        )}
        <span>{buttonLabel}</span>
      </button>
    </div>
  );
}
