import { useEffect, useId, useRef, useState } from "react";
import { Presence } from "../../shared/ui/Presence";
import { useTheme } from "../../shared/theme/ThemeProvider";
import { Icon } from "../../shared/ui/Icon";

export function SidebarAccountMenu({ name, onLogout }: { name: string; onLogout: () => Promise<void> }) {
  const { themeId, themeOptions, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const initial = name.trim().slice(0, 1).toUpperCase();
  const close = () => { setIsOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!isOpen) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener("pointerdown", outside);
  }, [isOpen]);

  return <div className="sidebar-account" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsOpen(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && isOpen) { event.preventDefault(); close(); return; }
      if (!isOpen && ["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); setIsOpen(true); return; }
      if (!isOpen) return;
      const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
      if (horizontal && (event.target as HTMLElement).getAttribute("role") !== "menuitemradio") return;
      if (!horizontal && !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      const selector = horizontal ? '[role="menuitemradio"]' : '[role^="menuitem"]:not(:disabled)';
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (at + (forward ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }}>
    <button type="button" className="sidebar-account-trigger" ref={trigger} aria-label={name} title={name}
      aria-haspopup="menu" aria-expanded={isOpen} aria-controls={menuId} onClick={() => setIsOpen(open => !open)}>
      <span className="sidebar-account-avatar" aria-hidden="true">{initial}</span>
    </button>
    <Presence kind="menu">{isOpen && <div id={menuId} className="form-menu-dropdown sidebar-account-menu" role="menu" aria-label="Меню пользователя">
      <div className="sidebar-account-header">
        <span className="sidebar-account-avatar" aria-hidden="true">{initial}</span>
        <span className="sidebar-account-full-name">{name}</span>
      </div>
      <div className="sidebar-theme-row" role="group" aria-labelledby={`${menuId}-theme`}>
        <span id={`${menuId}-theme`} className="sidebar-theme-label">Тема</span>
        <div className="sidebar-theme-switch">
          {themeOptions.map(option => <button key={option.id} type="button" role="menuitemradio"
            className="sidebar-theme-option" aria-label={`${option.label} тема`} title={`${option.label} тема`}
            aria-checked={themeId === option.id} data-theme-option={option.id} onClick={() => setTheme(option.id)}>
            <Icon name={option.id === "graphite" ? "dark_mode" : "light_mode"} />
          </button>)}
        </div>
      </div>
      <button type="button" role="menuitem" className="form-menu-item" disabled={busy}
        onClick={() => { setBusy(true); void onLogout().finally(() => setBusy(false)); }}>
        <Icon name="logout" /><span>Выйти</span>
      </button>
    </div>}</Presence>
  </div>;
}
