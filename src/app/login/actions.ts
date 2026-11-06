"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  defaultNextPath,
  loginWithPassword,
  safeNextPath,
  sessionFitsHost,
} from "@/lib/auth/login";
import { getUserClient, readSession } from "@/lib/auth/session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";

export type LoginState = { error: "invalid" | null };

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Set by the middleware from the host (never from the client): null on the agency host.
  const hostTenantId = (await headers()).get(TENANT_ID_HEADER);
  const next = safeNextPath(field(formData, "next"), defaultNextPath(hostTenantId));
  const supabase = await getUserClient();

  const result = await loginWithPassword(field(formData, "email"), field(formData, "password"), {
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? { status: error.status, code: error.code } : null };
    },
    signOut: async () => {
      await supabase.auth.signOut({ scope: "local" });
    },
    authorize: async () => sessionFitsHost(await readSession(supabase), hostTenantId),
  });
  if (!result.ok) return { error: "invalid" };
  redirect(next);
}

export async function logout(): Promise<void> {
  const supabase = await getUserClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
