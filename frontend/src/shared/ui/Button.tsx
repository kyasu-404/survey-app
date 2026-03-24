import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

export function Button({ children, ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button
      {...props}
      style={{
        border: "1px solid #ccc",
        borderRadius: 8,
        padding: "8px 12px",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
