import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requirePanelSession } from "@/lib/auth/panel-session";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { logout } from "../../login/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await requirePanelSession((await headers()).get(TENANT_ID_HEADER) ?? "");
  const t = await getTranslations("login");

  return (
    <>
      <header>
        <form action={logout}>
          <button type="submit">{t("logout")}</button>
        </form>
      </header>
      {children}
    </>
  );
}
