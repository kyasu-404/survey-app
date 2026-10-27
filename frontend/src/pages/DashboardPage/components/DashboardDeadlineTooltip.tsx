import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../../../shared/ui/Icon";
import { DashboardMenuPortal } from "./DashboardMenuPortal";

export function DashboardDeadlineTooltip({ label }: { label: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  return (
    <div
      ref={anchor}
      className="dashboard-table-deadline"
      role="img"
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => setFocused(false)}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="schedule" className="dashboard-meta-icon" size={16} />
      {open && (
        <DashboardMenuPortal anchor={anchor} enabled>
          <div id={id} role="tooltip" className="dashboard-deadline-tooltip">{label}</div>
        </DashboardMenuPortal>
      )}
    </div>
  );
}
