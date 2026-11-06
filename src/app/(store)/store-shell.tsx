import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { resolveImageSource } from "@/lib/store/assets";
import { themeToCssVars } from "@/lib/store/theme";
import { readCart, storeContext } from "./store-context";
import "./store.css";

// Frame of every store page. The tenant theme (already validated by listPublicCatalog)
// is applied as CSS custom properties on .store; themeToCssVars validates it again and
// emits only #rrggbb colors and fixed font stacks. Without a theme, store.css defaults
// apply. The logo URL is built here, server-side, from a path under the tenant's prefix.
export async function StoreShell({ children }: { children: ReactNode }) {
  const [ctx, cart, t] = await Promise.all([storeContext(), readCart(), getTranslations("store")]);
  const count = cart.lines.reduce((n, l) => n + l.qty, 0);
  const theme = ctx.catalog.theme;
  const logo = theme?.logoPath ? resolveImageSource(ctx.tenantId, theme.logoPath, ctx.storageUrl) : null;
  return (
    <div className="store" style={themeToCssVars(theme) as CSSProperties}>
      <a className="store-skip" href="#store-main">
        {t("skipToContent")}
      </a>
      <header className="store-header">
        <Link href="/" className="store-brand">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- public Storage URL of the tenant's own logo; next/image would need the host allowlisted per project
            <img src={logo} alt={ctx.tenant.name} className="store-logo" />
          ) : (
            ctx.tenant.name
          )}
        </Link>
        <nav aria-label={t("nav")}>
          <Link href="/cart" className="store-cart-link">
            {t("cart.link", { count })}
          </Link>
        </nav>
      </header>
      <main id="store-main" className="store-main">
        {children}
      </main>
    </div>
  );
}
