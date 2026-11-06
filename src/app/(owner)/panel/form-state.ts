// State returned by every panel server action (used with useActionState).
// errors: field name -> key under catalog.errors.* ("_form" for the whole form).
export type FormState = {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
};

export const IDLE: FormState = { status: "idle", errors: {} };

export const saved = (): FormState => ({ status: "saved", errors: {} });

export const failed = (errors: Record<string, string>): FormState => ({ status: "error", errors });
