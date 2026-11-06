"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkNewPassword } from "@/lib/auth/invite-accept";
import { defaultNextPath, safeNextPath } from "@/lib/auth/login";
import { getUserClient } from "@/lib/auth/session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { mayChangePassword } from "./guard";

export type SetPasswordState = {
  error: "tooShort" | "tooLong" | "mismatch" | "weak" | "failed" | null;
};

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function setPassword(
  _prev: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const hostTenantId = (await headers()).get(TENANT_ID_HEADER);
  const next = safeNextPath(field(formData, "next"), defaultNextPath(hostTenantId));
  const password = field(formData, "password");
  const problem = checkNewPassword(password, field(formData, "confirm"));
  if (problem) return { error: problem };

  const supabase = await getUserClient();
  if (!(await mayChangePassword(supabase))) redirect("/login?error=link");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password") return { error: "weak" };
    // same_password: the account already has exactly this password, nothing to change.
    if (error.code !== "same_password") {
      console.error("set-password: update failed", error.code ?? error.status);
      return { error: "failed" };
    }
  }
  redirect(next);
}
