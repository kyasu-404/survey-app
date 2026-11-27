import type { ReactNode } from "react";
import { Icon } from "./Icon";

type ModalHeadingProps = {
  children: ReactNode;
  className?: string;
  closeClassName?: string;
  onClose?: () => void;
  disabled?: boolean;
  label?: string;
};

export function ModalHeading({ children, className = "", closeClassName = "app-button icon-button", onClose, disabled, label = "Закрыть" }: ModalHeadingProps) {
  return <header className={`modal-heading ${className}`.trim()}>
    {children}
    <button type="button" className={`modal-close-button ${closeClassName}`.trim()} aria-label={label} onClick={onClose} disabled={disabled || !onClose}>
      <Icon name="close" className="modal-close-icon" />
    </button>
  </header>;
}
