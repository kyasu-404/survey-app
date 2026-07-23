import type { HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className = "", ...props }: SkeletonProps) {
  const classes = ["ui-skeleton", className].filter(Boolean).join(" ");

  return <div className={classes} aria-hidden="true" {...props} />;
}
