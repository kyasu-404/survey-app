import type { KeyboardEvent } from "react";
import { AnimatedTabs } from "./AnimatedTabs";

type SectionTabsProps<T extends string> = {
  id: string;
  label: string;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
};

export function SectionTabs<T extends string>({ id, label, tabs, value, onChange, compact }: SectionTabsProps<T>) {
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    onChange(tabs[next].value);
    document.getElementById(`${id}-tab-${tabs[next].value}`)?.focus();
  }

  const buttons = tabs.map((tab, index) => {
    const selected = value === tab.value;
    return <button key={tab.value} type="button" role="tab"
      id={`${id}-tab-${tab.value}`} aria-controls={`${id}-panel-${tab.value}`}
      aria-selected={selected} tabIndex={selected ? 0 : -1}
      className={compact ? "app-button" : selected ? "active" : undefined}
      onClick={() => onChange(tab.value)} onKeyDown={event => moveTab(event, index)}>
      {tab.label}
    </button>;
  });

  if (compact) return <div className="section-navigation" role="tablist" aria-label={label}>{buttons}</div>;

  return <AnimatedTabs className="organizations-type-switcher section-tabs" aria-label={label}>
    {buttons}
  </AnimatedTabs>;
}
