type InlineSpinnerProps = {
  className?: string;
};

export function InlineSpinner({ className = "" }: InlineSpinnerProps) {
  const classes = ["inline-spinner", className].filter(Boolean).join(" ");

  return <span className={classes} aria-hidden="true" />;
}
