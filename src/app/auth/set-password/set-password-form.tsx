"use client";

import { useActionState } from "react";
import type { SetPasswordState } from "./actions";

export type SetPasswordLabels = {
  title: string;
  password: string;
  confirm: string;
  hint: string;
  submit: string;
  errors: Record<string, string>;
};

export function SetPasswordForm({
  action,
  next,
  labels,
}: {
  action: (prev: SetPasswordState, fd: FormData) => Promise<SetPasswordState>;
  next: string;
  labels: SetPasswordLabels;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      <h1>{labels.title}</h1>
      {state.error && (
        <p role="alert" style={{ color: "crimson" }}>
          {labels.errors[state.error] ?? labels.errors.failed}
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <label>
        {labels.password}
        <input name="password" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <p>{labels.hint}</p>
      <label>
        {labels.confirm}
        <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </label>
      <button type="submit" disabled={pending}>
        {labels.submit}
      </button>
    </form>
  );
}
