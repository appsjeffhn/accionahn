"use client";

import { useActionState } from "react";

export type InviteState = {
  // resent: the owner already had an account here; a set-password link was emailed
  status: "idle" | "sent" | "resent" | "error";
  error?: "invalidEmail" | "alreadyMember" | "existingAccount" | "tenantNotActive" | "failed";
};

export type InviteLabels = {
  title: string;
  help: string;
  email: string;
  submit: string;
  sent: string;
  resent: string;
  errors: Record<string, string>;
};

export function InviteOwnerForm({
  action,
  labels,
}: {
  action: (prev: InviteState, fd: FormData) => Promise<InviteState>;
  labels: InviteLabels;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction}>
      <h2>{labels.title}</h2>
      <p>{labels.help}</p>
      {state.status === "sent" && <p role="status">{labels.sent}</p>}
      {state.status === "resent" && <p role="status">{labels.resent}</p>}
      {state.status === "error" && (
        <p role="alert" style={{ color: "crimson" }}>
          {labels.errors[state.error ?? "failed"] ?? labels.errors.failed}
        </p>
      )}
      <label>
        {labels.email}
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <button type="submit" disabled={pending}>
        {labels.submit}
      </button>
    </form>
  );
}
