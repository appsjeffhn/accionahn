"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  createLoginThrottle,
  defaultNextPath,
  loginWithPassword,
  safeNextPath,
  sessionFitsHost,
} from "@/lib/auth/login";
import { getUserClient, readSession } from "@/lib/auth/session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { clientKey } from "@/lib/store/throttle";

export type LoginState = { error: "invalid" | null };

// Per server instance; see createLoginThrottle. A limited attempt looks like a wrong password.
const loginThrottle = createLoginThrottle();

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Set by the middleware from the host (never from the client): null on the agency host.
  const requestHeaders = await headers();
  const hostTenantId = requestHeaders.get(TENANT_ID_HEADER);
  const client = clientKey(requestHeaders);
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
    allow: (email) => loginThrottle.take({ client, email }),
  });
  if (!result.ok) return { error: "invalid" };
  redirect(next);
}

export async function logout(): Promise<void> {
  const supabase = await getUserClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
