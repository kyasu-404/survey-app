import type { CSSProperties } from "react";
import symbols from "./materialSymbols.json";

export type IconName = keyof typeof symbols;

type IconProps = {
  name: IconName;
  size?: 16 | 18 | 20 | 24;
  filled?: boolean;
  className?: string;
  label?: string;
};

/** Decorative by default: the containing button/link keeps its accessible name. */
export function Icon({ name, size = 20, filled, className = "", label }: IconProps) {
  const style: CSSProperties & Record<`--icon-${string}`, string | number> = {
    "--icon-size": `${size}px`,
    "--icon-optical-size": Math.max(20, size),
  };
  if (filled !== undefined) style["--icon-fill"] = filled ? 1 : 0;

  return <span className={`material-symbols-outlined ${className}`.trim()} style={style}
    data-icon={name} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {String.fromCodePoint(Number.parseInt(symbols[name], 16))}
  </span>;
}
