"use client";

import { useActionState } from "react";
import type { LoginState } from "./actions";

export type LoginLabels = {
  title: string;
  email: string;
  password: string;
  submit: string;
  invalidCredentials: string;
  linkInvalid: string;
};

export function LoginForm({
  action,
  next,
  linkError,
  labels,
}: {
  action: (prev: LoginState, fd: FormData) => Promise<LoginState>;
  next: string;
  linkError: boolean;
  labels: LoginLabels;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const message =
    state.error === "invalid" ? labels.invalidCredentials : linkError ? labels.linkInvalid : null;

  return (
    <form action={formAction}>
      <h1>{labels.title}</h1>
      {message && (
        <p role="alert" style={{ color: "crimson" }}>
          {message}
        </p>
      )}
      <input type="hidden" name="next" value={next} />
      <label>
        {labels.email}
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        {labels.password}
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={pending}>
        {labels.submit}
      </button>
    </form>
  );
}
