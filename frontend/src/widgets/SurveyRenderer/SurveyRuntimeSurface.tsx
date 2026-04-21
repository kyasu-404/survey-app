import type { ReactNode } from "react";

type SurveyRuntimeSurfaceProps = {
  children: ReactNode;
  className?: string;
};

export function SurveyRuntimeSurface({ children, className }: SurveyRuntimeSurfaceProps) {
  const classes = ["survey-runtime-surface", "survey-page-card", className].filter(Boolean).join(" ");

  return <div className={classes}>{children}</div>;
}
