// State returned by the storefront's form actions (used with useActionState).
// errors: field name -> key under store.errors.* ("_form" for the whole form).
export type StoreFormState = {
  status: "idle" | "saved" | "error";
  errors: Record<string, string>;
};

export const IDLE: StoreFormState = { status: "idle", errors: {} };

export const saved = (): StoreFormState => ({ status: "saved", errors: {} });

export const failed = (errors: Record<string, string>): StoreFormState => ({ status: "error", errors });
