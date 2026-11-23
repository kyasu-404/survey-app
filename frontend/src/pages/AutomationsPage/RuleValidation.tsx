export type RuleFieldError = { id: string; message: string };

export function ruleErrorAttributes(error?: RuleFieldError) {
  return error ? { "aria-invalid": true as const, "aria-describedby": error.id } : {};
}

export function RuleFieldErrorMessage({ error }: { error?: RuleFieldError }) {
  return error ? <p id={error.id} className="activity-error rule-field-error" role="alert">{error.message}</p> : null;
}
