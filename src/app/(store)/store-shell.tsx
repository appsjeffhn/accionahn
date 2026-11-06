import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { readCart, storeContext } from "./store-context";
import "./store.css";

// Theme hook: Task 11 passes the tenant's theme here as CSS custom properties
// (--store-bg, --store-fg, --store-accent, ...). store.css holds the defaults.
export type StoreTheme = Partial<Record<`--store-${string}`, string>>;

export async function StoreShell({ children, theme }: { children: ReactNode; theme?: StoreTheme }) {
  const [ctx, cart, t] = await Promise.all([storeContext(), readCart(), getTranslations("store")]);
  const count = cart.lines.reduce((n, l) => n + l.qty, 0);
  return (
    <div className="store" style={theme as CSSProperties | undefined}>
      <a className="store-skip" href="#store-main">
        {t("skipToContent")}
      </a>
      <header className="store-header">
        <Link href="/" className="store-brand">
          {ctx.tenant.name}
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
