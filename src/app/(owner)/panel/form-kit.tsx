"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { IDLE, type FormState } from "./form-state";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

const StateContext = createContext<FormState>(IDLE);

function useErrorText(name: string): string | null {
  return useErrorTextFrom(useContext(StateContext), name);
}

// A form bound to a server action. Submitted through a transition so React does not
// reset the fields: after an error the owner's input stays as typed. The server action
// revalidates the page on success; forms for new items are keyed by their new id so they
// start empty again.
export function PanelForm({
  action,
  submitLabel,
  submitAriaLabel,
  confirmText,
  danger,
  className,
  children,
}: {
  action: Action;
  submitLabel: string;
  // Accessible name when the visible label alone is ambiguous (e.g. "Delete" in a list).
  submitAriaLabel?: string;
  confirmText?: string;
  danger?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const t = useTranslations("panel.form");
  const ref = useRef<HTMLFormElement>(null);
  const formError = useErrorTextFrom(state, "_form");
  const hasFieldErrors = Object.keys(state.errors).some((k) => k !== "_form");

  useEffect(() => {
    if (state.status !== "error") return;
    ref.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-error]')?.focus();
  }, [state]);

  return (
    <form
      ref={ref}
      className={className ?? "panel-form"}
      // Before hydration a submit uses the HTML method: POST, never a GET with the
      // fields in the URL.
      method="post"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const fd = new FormData(event.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
      {formError && (
        <p className="form-error" role="alert" tabIndex={-1} data-form-error>
          {formError}
        </p>
      )}
      {!formError && hasFieldErrors && (
        <p className="form-error" role="alert">
          {t("fixFields")}
        </p>
      )}
      <div className="form-actions">
        <button
          type="submit"
          disabled={pending}
          className={danger ? "danger" : undefined}
          aria-label={submitAriaLabel}
        >
          {pending ? t("saving") : submitLabel}
        </button>
        <span role="status" aria-live="polite" className="form-status">
          {state.status === "saved" && !pending ? t("saved") : ""}
        </span>
      </div>
    </form>
  );
}

function useErrorTextFrom(state: FormState, name: string): string | null {
  const t = useTranslations("catalog.errors");
  const key = state.errors[name];
  if (!key) return null;
  return t.has(key) ? t(key) : t("invalid");
}

function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter(Boolean);
  return list.length > 0 ? list.join(" ") : undefined;
}

type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  // Error shown under this field; defaults to `name`.
  errorName?: string;
  defaultValue?: string;
  type?: string;
  inputMode?: "text" | "decimal" | "numeric";
  required?: boolean;
  placeholder?: string;
  list?: string;
  min?: string;
  max?: string;
  step?: string;
  autoComplete?: string;
  // File inputs only.
  accept?: string;
};

export function Field({ name, label, hint, errorName, type = "text", required, ...rest }: FieldProps) {
  const id = useId();
  const error = useErrorText(errorName ?? name);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        {...rest}
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  name,
  label,
  hint,
  defaultValue,
  required,
  rows = 3,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  required?: boolean;
  rows?: number;
}) {
  const id = useId();
  const error = useErrorText(name);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
      />
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Select({
  name,
  label,
  options,
  defaultValue,
  hint,
  onChange,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const error = useErrorText(name);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Check({
  name,
  label,
  defaultChecked,
  value,
  hint,
  onChange,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  value?: string;
  hint?: string;
  onChange?: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="check">
      <input
        id={id}
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}

// Error of a group (a list, a row, a set of checkboxes) that has no single input.
export function FieldError({ name }: { name: string }) {
  const error = useErrorText(name);
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

export function Hidden({ name, value }: { name: string; value: string }) {
  return <input type="hidden" name={name} value={value} />;
}
