import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { defaultNextPath, safeNextPath } from "@/lib/auth/login";
import { getUserClient } from "@/lib/auth/session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { setPassword } from "./actions";
import { SetPasswordForm } from "./set-password-form";

export const dynamic = "force-dynamic";

// Reached from /auth/callback right after the invitation token was verified.
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { data } = await (await getUserClient()).auth.getUser();
  if (!data.user) redirect("/login?error=link");

  const params = await searchParams;
  const hostTenantId = (await headers()).get(TENANT_ID_HEADER);
  const next = safeNextPath(params.next, defaultNextPath(hostTenantId));
  const t = await getTranslations("setPassword");

  return (
    <main>
      <SetPasswordForm
        action={setPassword}
        next={next}
        labels={{
          title: t("title"),
          password: t("password"),
          confirm: t("confirm"),
          hint: t("hint"),
          submit: t("submit"),
          errors: Object.fromEntries(
            ["tooShort", "tooLong", "mismatch", "weak", "failed"].map((k) => [k, t(`errors.${k}`)]),
          ),
        }}
      />
    </main>
  );
}
