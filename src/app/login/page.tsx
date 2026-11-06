import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { defaultNextPath, safeNextPath } from "@/lib/auth/login";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { login } from "./actions";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

// Served on both host kinds: the agency host (default next /agency) and every active
// tenant host (default next /panel). The action re-validates next on submit.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const hostTenantId = (await headers()).get(TENANT_ID_HEADER);
  const next = safeNextPath(params.next, defaultNextPath(hostTenantId));
  const t = await getTranslations("login");

  return (
    <main>
      <LoginForm
        action={login}
        next={next}
        linkError={params.error === "link"}
        labels={{
          title: t("title"),
          email: t("email"),
          password: t("password"),
          submit: t("submit"),
          invalidCredentials: t("invalidCredentials"),
          linkInvalid: t("linkInvalid"),
        }}
      />
    </main>
  );
}
