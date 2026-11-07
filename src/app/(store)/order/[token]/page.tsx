import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PROOF_MAX_BYTES } from "@/lib/orders/operations";
import { getPublicOrder, trackingDisplay } from "@/lib/orders/public-order";
import { formatMoney } from "@/lib/pricing/money";
import { formatDateTime, localized } from "@/lib/store/view";
import { uploadProofAction } from "../../actions";
import { storeContext } from "../../store-context";
import { FileField, StoreForm } from "../../store-forms";

export const dynamic = "force-dynamic";

// The link is the only key to the order: never indexed, never sent as a referrer.
// next.config.ts adds the same policy as response headers (Referrer-Policy, X-Robots-Tag,
// Cache-Control: no-store) for /order/*.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getTranslations("store.order"))("title"),
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

export default async function OrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await storeContext();
  const order = await getPublicOrder(token, ctx.tenantId);
  if (!order) notFound();

  const t = await getTranslations("store.order");
  const ts = await getTranslations("store");
  const { locale, settings } = ctx;
  const money = (minor: number) => formatMoney(minor, order.currency, locale);
  const when = (iso: string) => formatDateTime(iso, locale, settings.timezone);
  const firm = order.totalMinor !== null && order.depositDueMinor !== null && order.dueOnDeliveryMinor !== null;
  const shipping =
    order.status === "pending_shipping"
      ? ts("breakdown.shippingToConfirm")
      : firm
        ? money(order.totalMinor! - order.subtotalMinor)
        : order.shippingFeeMinor !== null
          ? formatMoney(order.shippingFeeMinor, order.baseCurrency, locale)
          : ts("breakdown.shippingToConfirm");
  const show = trackingDisplay(order);
  const instructions = order.paymentInstructions
    ? order.paymentInstructions[locale] || order.paymentInstructions[locale === "es" ? "en" : "es"]
    : null;

  return (
    <>
      <h1>{t("title")}</h1>
      <p>
        <span className="store-badge">{t(show.statusKey)}</span>
      </p>
      <p className={show.expired ? "store-notice" : undefined}>{t(show.helpKey)}</p>
      <p className="store-hint">{t("keepLink")}</p>

      {show.showPayment && order.depositDueMinor !== null && (
        <section aria-labelledby="pay-title" className="store-card">
          <h2 id="pay-title">{t("payTitle")}</h2>
          <p>
            <strong>{t("depositDue", { amount: money(order.depositDueMinor) })}</strong>
          </p>
          {order.holdExpiresAt && <p>{t("deadline", { when: when(order.holdExpiresAt) })}</p>}
          {instructions ? (
            <>
              <h3>{t("instructionsTitle")}</h3>
              <p className="store-instructions">{instructions}</p>
            </>
          ) : (
            <p>{t("noInstructions")}</p>
          )}
          {order.rejectionReason && (
            <p className="store-notice">{t("proofRejected", { reason: order.rejectionReason })}</p>
          )}
          {show.showUpload ? (
            <StoreForm
              action={uploadProofAction}
              submitLabel={t("proofSubmit")}
              savedText={t("proofSaved")}
              maxFileBytes={PROOF_MAX_BYTES}
            >
              <input type="hidden" name="token" value={token} />
              <FileField name="proof" label={t("proofLabel")} hint={t("proofHint")} />
            </StoreForm>
          ) : (
            <p className="store-notice">{t("deadlinePassed")}</p>
          )}
        </section>
      )}

      {order.status === "awaiting_review" && order.latestProof?.status === "pending" && (
        <p className="store-notice">{t("proofInReview", { when: when(order.latestProof.createdAt) })}</p>
      )}

      <h2>{t("detailTitle")}</h2>
      <ul className="store-lines">
        {order.lines.map((line, i) => {
          const variant = localized(line.variantLabel, locale);
          const options = [...line.meats, ...line.toppings];
          return (
            <li key={i} className="store-card">
              <div className="store-line-head">
                <strong>
                  {line.qty} × {localized(line.name, locale) || ts("unnamed")}
                  {variant && ` · ${variant}`}
                </strong>
                <span className="store-price">{line.pendingQuote ? ts("toBeQuoted") : money(line.totalMinor)}</span>
              </div>
              {line.people !== null && <p className="store-hint">{ts("cart.people", { count: line.people })}</p>}
              {options.length > 0 && <p className="store-hint">{ts("cart.options", { list: options.join(", ") })}</p>}
              {line.start && <p className="store-hint">{ts("cart.slot", { when: when(line.start) })}</p>}
            </li>
          );
        })}
      </ul>

      <dl className="store-breakdown">
        <dt>{ts("breakdown.subtotal")}</dt>
        <dd>{order.status === "pending_quote" ? ts("toBeQuoted") : money(order.subtotalMinor)}</dd>
        <dt>{ts("breakdown.shipping")}</dt>
        <dd>{shipping}</dd>
        <dt className="store-total">{ts("breakdown.total")}</dt>
        <dd className="store-total">
          {firm ? money(order.totalMinor!) : order.status === "pending_quote" ? ts("toBeQuoted") : ts("breakdown.shippingToConfirm")}
        </dd>
        {firm && (
          <>
            <dt>{ts("breakdown.deposit")}</dt>
            <dd>{money(order.depositDueMinor!)}</dd>
            <dt>{ts("breakdown.onDelivery")}</dt>
            <dd>{money(order.dueOnDeliveryMinor!)}</dd>
          </>
        )}
      </dl>

      {Object.keys(order.fields).length > 0 && (
        <>
          <h2>{t("yourDetails")}</h2>
          <dl className="store-breakdown">
            {Object.entries(order.fields).map(([key, value]) => (
              <div key={key} style={{ display: "contents" }}>
                <dt>{ts.has(`fields.${key}`) ? ts(`fields.${key}`) : key}</dt>
                <dd className="store-instructions">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <p>
        <Link href="/">{t("backToStore")}</Link>
      </p>
    </>
  );
}
