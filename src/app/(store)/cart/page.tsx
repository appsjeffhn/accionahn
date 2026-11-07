import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { canCheckout, cartIssues, quoteForDisplay } from "@/lib/cart/cart";
import { Breakdown, CartLines, type ShippingView } from "../cart-view";
import { readCart, storeContext } from "../store-context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("store"))("cart.title") };
}

export default async function CartPage() {
  const [ctx, cart, t] = await Promise.all([storeContext(), readCart(), getTranslations("store")]);
  const opts = { locale: ctx.locale, currency: ctx.tenant.baseCurrency, timezone: ctx.settings.timezone };

  if (cart.lines.length === 0) {
    return (
      <>
        <h1>{t("cart.title")}</h1>
        <p>{t("cart.empty")}</p>
        <p>
          <Link href="/">{t("cart.keepShopping")}</Link>
        </p>
      </>
    );
  }

  // The zone (and the date of a single-date order) is chosen at checkout.
  const quote = quoteForDisplay(cart, ctx.catalog, { baseCurrency: ctx.tenant.baseCurrency, rates: ctx.rates });
  const issues = cartIssues(cart, ctx.catalog);
  const ready = canCheckout(cart, ctx.catalog, quote, { zoneChosen: false });
  const mode = ctx.settings.mode;
  const shipping: ShippingView =
    mode === "none"
      ? { kind: "none" }
      : mode === "fixed"
        ? { kind: "amount", minor: quote.shipping.minor }
        : mode === "zones"
          ? { kind: "chooseZone" }
          : { kind: "toConfirm" };

  return (
    <>
      <h1>{t("cart.title")}</h1>
      <CartLines cart={cart} catalog={ctx.catalog} quote={quote} issues={issues} opts={opts} removable />
      <h2>{t("cart.summary")}</h2>
      <Breakdown quote={quote} shipping={shipping} opts={opts} />
      {ready ? (
        <p>
          <Link href="/checkout" className="store-button">
            {t("cart.checkout")}
          </Link>
        </p>
      ) : (
        <p className="store-error" role="status">
          {t("cart.fixFirst")}
        </p>
      )}
      <p>
        <Link href="/">{t("cart.keepShopping")}</Link>
      </p>
    </>
  );
}
