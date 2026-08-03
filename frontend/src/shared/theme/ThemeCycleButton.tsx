import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import settingsIcon from "../../img/Settings.svg";
import { themes } from "./themeRegistry";
import { useTheme } from "./ThemeProvider";

type ThemeCycleButtonProps = {
  className?: string;
  menuPlacement?: "bottom-end" | "top-right";
};

export function ThemeCycleButton({ className, menuPlacement = "bottom-end" }: ThemeCycleButtonProps) {
  const { setTheme, theme, themeId, themeOptions } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const classes = ["app-button", "theme-cycle-button", className].filter(Boolean).join(" ");

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleDocumentMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentMouseDown);
    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isOpen]);

  function stopMenuEvent(event: ReactMouseEvent | ReactKeyboardEvent) {
    event.stopPropagation();
  }

  return (
    <div className="theme-cycle-button-shell" data-menu-placement={menuPlacement} data-menu-open={isOpen} ref={rootRef}>
      <button
        type="button"
        className={classes}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={`Сменить тему. Сейчас ${theme.app.label}.`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        title="Выбрать тему"
        data-theme-id={themeId}
        data-menu-open={isOpen}
      >
        <img src={settingsIcon} alt="" aria-hidden="true" className="theme-cycle-button-icon" />
      </button>

      {isOpen && (
        <div
          id={menuId}
          className="form-menu-dropdown form-menu-dropdown-inline theme-cycle-menu"
          data-menu-placement={menuPlacement}
          role="menu"
          aria-label="Выбор темы"
          onClick={stopMenuEvent}
        >
          {themeOptions.map((option) => {
            const isActive = option.id === themeId;
            const optionTheme = themes[option.id].app;
            const optionStyle = {
              "--theme-option-accent": optionTheme.accent,
              "--theme-option-accent-hover": optionTheme.accentHover,
              "--theme-option-surface": optionTheme.surface,
              "--theme-option-text": optionTheme.text,
              "--theme-option-muted": optionTheme.muted,
            } as CSSProperties;

            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                data-theme-option={option.id}
                className={`form-menu-item theme-cycle-menu-item ${isActive ? "theme-cycle-menu-item-active" : ""}`.trim()}
                style={optionStyle}
                onClick={(event) => {
                  stopMenuEvent(event);
                  setTheme(option.id);
                  setIsOpen(false);
                }}
              >
                <span className="theme-cycle-menu-item-swatch" aria-hidden="true" />
                <span className="theme-cycle-menu-item-label">{option.label}</span>
                <span className="theme-cycle-menu-item-state" aria-hidden="true">
                  {isActive ? "●" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
