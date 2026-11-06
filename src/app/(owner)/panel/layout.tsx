import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { logout } from "../../login/actions";
import { panelSession } from "./session";
import "./panel.css";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  await panelSession();
  const [t, tl] = await Promise.all([getTranslations("panel.nav"), getTranslations("login")]);

  return (
    <div className="panel">
      <header className="panel-header">
        <nav aria-label={t("label")}>
          <ul>
            <li>
              <Link href="/panel">{t("home")}</Link>
            </li>
            <li>
              <Link href="/panel/orders">{t("orders")}</Link>
            </li>
            <li>
              <Link href="/panel/products">{t("products")}</Link>
            </li>
            <li>
              <Link href="/panel/calendar">{t("calendar")}</Link>
            </li>
            <li>
              <Link href="/panel/settings">{t("settings")}</Link>
            </li>
            <li>
              <Link href="/panel/appearance">{t("appearance")}</Link>
            </li>
          </ul>
        </nav>
        <form action={logout}>
          <button type="submit">{tl("logout")}</button>
        </form>
      </header>
      {children}
    </div>
  );
}
