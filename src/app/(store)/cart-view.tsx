import { getTranslations } from "next-intl/server";
import { lineVariant, type Cart, type CartIssue } from "@/lib/cart/cart";
import type { PublicCatalog } from "@/lib/catalog/catalog";
import { formatMoney } from "@/lib/pricing/money";
import type { Quote } from "@/lib/pricing/types";
import { lineErrorKey } from "@/lib/store/checkout";
import { formatDateTime, localized, type StoreLocale } from "@/lib/store/view";
import { removeFromCartAction } from "./actions";

type ViewOpts = { locale: StoreLocale; currency: string; timezone: string };

// The cart's lines with the amounts of the display quote and anything that blocks them.
export async function CartLines({
  cart,
  catalog,
  quote,
  issues,
  opts,
  removable,
}: {
  cart: Cart;
  catalog: PublicCatalog;
  quote: Quote;
  issues: CartIssue[];
  opts: ViewOpts;
  removable?: boolean;
}) {
  const t = await getTranslations("store");
  const money = (minor: number) => formatMoney(minor, opts.currency, opts.locale);
  return (
    <ul className="store-lines">
      {cart.lines.map((line) => {
        const product = catalog.products.find((p) => p.id === line.productId);
        const variant = lineVariant(line, catalog);
        const name = product ? localized(product.name, opts.locale) || t("unnamed") : t("cart.unavailableProduct");
        const amounts = quote.lines.find((l) => l.lineId === line.lineId);
        const codes = [
          ...issues.filter((i) => i.lineId === line.lineId).map((i) => i.code as string),
          ...quote.errors.filter((e) => e.lineId === line.lineId).map((e) => e.code),
        ];
        const pending = codes.length === 0 && amounts?.depositMinor === null;
        const options = [...(line.meats ?? []), ...(line.toppings ?? [])];
        return (
          <li key={line.lineId} className="store-card">
            <div className="store-line-head">
              <strong>
                {line.qty} × {name}
                {variant && ` · ${localized(variant.label, opts.locale)}`}
              </strong>
              <span className="store-price">
                {codes.length > 0 ? "" : pending ? t("toBeQuoted") : amounts ? money(amounts.totalMinor) : ""}
              </span>
            </div>
            {typeof line.people === "number" && <p className="store-hint">{t("cart.people", { count: line.people })}</p>}
            {options.length > 0 && <p className="store-hint">{t("cart.options", { list: options.join(", ") })}</p>}
            {amounts && amounts.extrasMinor > 0 && (
              <p className="store-hint">{t("cart.extras", { amount: money(amounts.extrasMinor) })}</p>
            )}
            {amounts && amounts.dateMinor > 0 && (
              <p className="store-hint">{t("cart.dateSurcharge", { amount: money(amounts.dateMinor) })}</p>
            )}
            {line.start && <p className="store-hint">{t("cart.slot", { when: formatDateTime(line.start, opts.locale, opts.timezone) })}</p>}
            {pending && <p className="store-hint">{t("cart.pendingQuote")}</p>}
            {codes.map((code) => (
              <p key={code} className="store-field-error">
                {t(`errors.${lineErrorKey(code)}`)}
              </p>
            ))}
            {removable && (
              <form action={removeFromCartAction}>
                <input type="hidden" name="lineId" value={line.lineId} />
                <button type="submit" className="store-button-quiet" aria-label={t("cart.removeNamed", { name })}>
                  {t("cart.remove")}
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export type ShippingView =
  | { kind: "none" }
  | { kind: "amount"; minor: number }
  | { kind: "chooseZone" }
  | { kind: "toConfirm" };

// Subtotal, shipping, total and what is paid now. Without a firm total (shipping to be
// confirmed by the owner, or a group to be quoted) no total or deposit is shown.
export async function Breakdown({
  quote,
  shipping,
  opts,
}: {
  quote: Quote;
  shipping: ShippingView;
  opts: ViewOpts;
}) {
  const t = await getTranslations("store.breakdown");
  const money = (minor: number) => formatMoney(minor, opts.currency, opts.locale);
  const pendingQuote = quote.status === "pending_quote";
  const pendingShipping = shipping.kind === "toConfirm";
  const firm = quote.totalMinor !== null && quote.depositDueMinor !== null && quote.dueOnDeliveryMinor !== null;
  return (
    <>
      <dl className="store-breakdown">
        <dt>{t("subtotal")}</dt>
        <dd>{pendingQuote ? t("toBeQuoted") : money(quote.subtotalMinor)}</dd>
        {shipping.kind !== "none" && (
          <>
            <dt>{t("shipping")}</dt>
            <dd>
              {shipping.kind === "amount"
                ? money(shipping.minor)
                : shipping.kind === "chooseZone"
                  ? t("chooseZone")
                  : t("shippingToConfirm")}
            </dd>
          </>
        )}
        <dt className="store-total">{t("total")}</dt>
        <dd className="store-total">
          {firm ? money(quote.totalMinor!) : pendingQuote ? t("toBeQuoted") : pendingShipping ? t("shippingToConfirm") : "—"}
        </dd>
        {firm && (
          <>
            <dt>{t("depositNow")}</dt>
            <dd>{money(quote.depositDueMinor!)}</dd>
            <dt>{t("onDelivery")}</dt>
            <dd>{money(quote.dueOnDeliveryMinor!)}</dd>
          </>
        )}
      </dl>
      {pendingQuote && <p className="store-hint">{t("pendingQuoteNote")}</p>}
      {!pendingQuote && pendingShipping && <p className="store-hint">{t("pendingShippingNote")}</p>}
    </>
  );
}
