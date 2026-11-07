import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { formatMoney } from "@/lib/pricing/money";
import { loadTenantCurrencies } from "@/lib/store/setup";
import { panelSession } from "../session";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const { session, tenantId } = await panelSession();
  const [catalog, currencies, t, locale] = await Promise.all([
    listOwnerCatalog(session, tenantId),
    loadTenantCurrencies(session),
    getTranslations("panel.products"),
    getLocale(),
  ]);
  const lang = locale === "en" ? "en" : "es";

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>
        <Link href="/panel/products/new" className="button">
          {t("new")}
        </Link>
      </p>
      {catalog.products.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="cards">
          {catalog.products.map((p) => {
            const name = (p.name ?? {}) as Record<string, string>;
            const variants = catalog.variants.filter((v) => v.product_id === p.id && v.active === true);
            return (
              <li key={String(p.id)} className="card">
                <h2>
                  <Link href={`/panel/products/${String(p.id)}`}>{name[lang] || name.es || name.en}</Link>
                </h2>
                <p>
                  {p.kind === "configurable" ? t("kindConfigurable") : t("kindSimple")}
                  {p.reservable === true && ` · ${t("reservable")}`}
                  {" · "}
                  {p.active === true ? t("active") : <strong>{t("inactive")}</strong>}
                </p>
                <p>
                  {t("price")}: {formatMoney(Number(p.price_minor), currencies.baseCurrency, lang)}
                  {variants.length > 0 && ` · ${t("variants", { count: variants.length })}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
