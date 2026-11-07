import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/pricing/money";
import type { ConfigurableDef } from "@/lib/pricing/types";
import { resolveImageSource } from "@/lib/store/assets";
import { localizedThemeText } from "@/lib/store/theme";
import { fromPricePerPerson, localized } from "@/lib/store/view";
import { storeContext } from "./store-context";

// The store's home: its active products. Served at / of a tenant host by src/app/page.tsx.
export async function StoreHome() {
  const [ctx, t] = await Promise.all([storeContext(), getTranslations("store")]);
  const { catalog, locale, tenant } = ctx;
  const money = (minor: number) => formatMoney(minor, tenant.baseCurrency, locale);
  // Owner texts from the validated theme, rendered as escaped text.
  const heading = catalog.theme ? localizedThemeText(catalog.theme.heading, locale) : null;
  const tagline = catalog.theme ? localizedThemeText(catalog.theme.tagline, locale) : null;

  return (
    <>
      <h1>{heading ?? t("home.title", { name: tenant.name })}</h1>
      {tagline && <p className="store-tagline">{tagline}</p>}
      {catalog.products.length === 0 ? (
        <p>{t("home.empty")}</p>
      ) : (
        <ul className="store-grid">
          {catalog.products.map((p) => {
            const id = p.id as string;
            const name = localized(p.name, locale) || t("unnamed");
            const variants = catalog.variants.filter((v) => v.product_id === id);
            const soldOut = variants.length > 0 && variants.every((v) => !v.inStock);
            const image = Array.isArray(p.images) ? resolveImageSource(ctx.tenantId, p.images[0], ctx.storageUrl) : null;
            const perPerson = p.kind === "configurable" ? fromPricePerPerson(p.configurable as ConfigurableDef | null) : null;
            return (
              <li key={id} className="store-card">
                <Link href={`/p/${id}`}>
                  {image && (
                    // eslint-disable-next-line @next/next/no-img-element -- only the tenant's own Storage images (resolveImageSource); next/image would need the host allowlisted per project
                    <img src={image} alt="" loading="lazy" />
                  )}
                  <h2>{name}</h2>
                  <p className="store-hint">{localized(p.description, locale)}</p>
                  <p className="store-price">
                    {p.kind === "configurable"
                      ? perPerson !== null && t("home.fromPerPerson", { price: money(perPerson) })
                      : money(Number(p.price_minor))}
                  </p>
                  {soldOut && <p className="store-badge">{t("soldOut")}</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
