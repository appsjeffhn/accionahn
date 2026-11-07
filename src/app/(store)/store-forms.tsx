"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { failed, IDLE, type StoreFormState } from "./form-state";

type Action = (prev: StoreFormState, fd: FormData) => Promise<StoreFormState>;

const StateContext = createContext<StoreFormState>(IDLE);

function useErrorKey(name: string): string | null {
  return useContext(StateContext).errors[name] ?? null;
}

// A form bound to a storefront server action. Submitted in a transition so the
// customer's input stays after an error; the first invalid field (or the form error)
// takes focus so screen readers announce it.
export function StoreForm({
  action,
  submitLabel,
  savedText,
  className,
  maxFileBytes,
  children,
}: {
  action: Action;
  submitLabel: string;
  savedText?: string;
  className?: string;
  // Files above this are refused here, before sending: the server also refuses bodies
  // above its limit, but then the customer would only see a generic error page.
  maxFileBytes?: number;
  children?: ReactNode;
}) {
  const [serverState, formAction, pending] = useActionState(action, IDLE);
  const [local, setLocal] = useState<StoreFormState | null>(null);
  const state = local ?? serverState;
  const t = useTranslations("store");
  const ref = useRef<HTMLFormElement>(null);
  const formError = state.errors._form;
  const hasFieldErrors = Object.keys(state.errors).some((k) => k !== "_form");

  useEffect(() => {
    if (state.status !== "error") return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-error]')?.focus();
  }, [state]);

  return (
    <form
      ref={ref}
      className={className ?? "store-form"}
      // Before hydration a submit uses the HTML method: a POST keeps the customer's
      // data out of the URL (a GET would put name, phone and address in it).
      method="post"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (maxFileBytes !== undefined) {
          for (const [name, value] of fd.entries()) {
            if (value instanceof File && value.size > maxFileBytes) {
              setLocal(failed({ [name]: "tooLarge" }));
              return;
            }
          }
        }
        setLocal(null);
        startTransition(() => formAction(fd));
      }}
    >
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
      {formError && (
        <p className="store-error" role="alert" tabIndex={-1} data-form-error>
          {t(`errors.${formError}`)}
        </p>
      )}
      {!formError && hasFieldErrors && (
        <p className="store-error" role="alert">
          {t("errors.checkFields")}
        </p>
      )}
      {state.status === "saved" && savedText && (
        <p className="store-ok" role="status">
          {savedText}
        </p>
      )}
      <button type="submit" className="store-button" disabled={pending} aria-busy={pending}>
        {pending ? t("sending") : submitLabel}
      </button>
    </form>
  );
}

// Error text of one field, linked to the input with aria-describedby.
export function FieldError({ id, name }: { id: string; name: string }) {
  const key = useErrorKey(name);
  const t = useTranslations("store");
  if (!key) return null;
  return (
    <p id={id} className="store-field-error">
      {t(`errors.${key}`)}
    </p>
  );
}

export function useFieldA11y(name: string) {
  const id = useId();
  const key = useErrorKey(name);
  return {
    inputId: `${id}-input`,
    errorId: `${id}-error`,
    invalid: key !== null,
    describedBy: key ? `${id}-error` : undefined,
  };
}

export function TextField({
  name,
  label,
  required,
  type = "text",
  autoComplete,
  inputMode,
  hint,
  multiline,
  min,
  max,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "tel" | "date" | "time";
  autoComplete?: string;
  inputMode?: "text" | "tel" | "numeric";
  hint?: string;
  multiline?: boolean;
  min?: string;
  max?: string;
}) {
  const a = useFieldA11y(name);
  const t = useTranslations("store");
  const hintId = hint ? `${a.inputId}-hint` : undefined;
  const describedBy = [hintId, a.describedBy].filter(Boolean).join(" ") || undefined;
  const common = {
    id: a.inputId,
    name,
    required,
    "aria-invalid": a.invalid || undefined,
    "aria-describedby": describedBy,
  };
  return (
    <div className="store-field">
      <label htmlFor={a.inputId}>
        {label}
        {!required && <span className="store-optional"> ({t("optional")})</span>}
      </label>
      {hint && (
        <p id={hintId} className="store-hint">
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea {...common} rows={3} maxLength={1000} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} inputMode={inputMode} maxLength={type === "text" ? 1000 : undefined} min={min} max={max} />
      )}
      <FieldError id={a.errorId} name={name} />
    </div>
  );
}

export function FileField({ name, label, hint }: { name: string; label: string; hint: string }) {
  const a = useFieldA11y(name);
  const hintId = `${a.inputId}-hint`;
  return (
    <div className="store-field">
      <label htmlFor={a.inputId}>{label}</label>
      <p id={hintId} className="store-hint">
        {hint}
      </p>
      <input
        id={a.inputId}
        name={name}
        type="file"
        required
        accept="image/jpeg,image/png,image/webp,application/pdf"
        aria-invalid={a.invalid || undefined}
        aria-describedby={[hintId, a.describedBy].filter(Boolean).join(" ")}
      />
      <FieldError id={a.errorId} name={name} />
    </div>
  );
}

// A group of radio buttons rendered by the server (slots), with its own error line.
export function RadioGroupError({ name, children, legend }: { name: string; legend: string; children: ReactNode }) {
  const a = useFieldA11y(name);
  return (
    <fieldset
      className="store-fieldset"
      aria-invalid={a.invalid || undefined}
      aria-describedby={a.describedBy}
      tabIndex={a.invalid ? -1 : undefined}
    >
      <legend>{legend}</legend>
      {children}
      <FieldError id={a.errorId} name={name} />
    </fieldset>
  );
}
