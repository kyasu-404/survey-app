import type { ReactNode } from "react";
import { Icon } from "./Icon";

type ModalHeadingProps = {
  children: ReactNode;
  className?: string;
  closeClassName?: string;
  onClose?: () => void;
  disabled?: boolean;
  label?: string;
  graphiteText?: string;
  lightOnly?: boolean;
};

export function ModalHeading({ children, className = "", closeClassName = "app-button icon-button", onClose, disabled, label = "Закрыть", graphiteText, lightOnly }: ModalHeadingProps) {
  return <header className={`modal-heading ${className}${lightOnly ? " modal-heading-light-only" : ""}`}>
    {children}
    <button type="button" className={`modal-close-button ${closeClassName}${lightOnly ? " modal-close-button-light-only" : ""}`} aria-label={label} onClick={onClose} disabled={disabled || !onClose}>
      <Icon name="close" className="modal-close-icon" />
      {graphiteText && <span className="modal-close-graphite-text">{graphiteText}</span>}
    </button>
  </header>;
}
