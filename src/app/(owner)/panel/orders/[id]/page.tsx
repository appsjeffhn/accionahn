import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import {
  actorKind,
  breakdown,
  formatWhen,
  isReviewOverdue,
  lineText,
  moneyOrPending,
  orderActions,
  unpricedLines,
  REVIEW_ALERT_HOURS,
} from "@/lib/orders/orders-view";
import { getPanelOrder, panelTimeZone, signProofs } from "@/lib/orders/panel-orders";
import { Field, Hidden, PanelForm, TextArea } from "../../form-kit";
import { panelSession } from "../../session";
import { approveAction, cancelAction, rejectAction, setPriceAction, setShippingAction } from "../actions";

export const dynamic = "force-dynamic";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await panelSession();
  const { id } = await params;
  const order = await getPanelOrder(session, id);
  if (!order) notFound();

  // Signed here, per request, for 5 minutes; only the URL reaches the HTML.
  const [proofs, timeZone, t, tAll, locale] = await Promise.all([
    signProofs(session, order),
    panelTimeZone(session),
    getTranslations("panel.orders"),
    getTranslations(),
    getLocale(),
  ]);
  const lang = locale === "en" ? "en" : "es";
  const when = (iso: string) => formatWhen(iso, lang, timeZone);
  const money = breakdown(order, lang);
  const hasPendingProof = order.proofs.some((p) => p.status === "pending");
  const unpriced = unpricedLines(order.lines);
  const actions = orderActions(order.status, hasPendingProof, unpriced);
  const overdue = isReviewOverdue(
    {
      status: order.status,
      createdAt: order.createdAt,
      reviewSince: order.events.filter((e) => e.toStatus === "awaiting_review").at(-1)?.at ?? null,
    },
    new Date(),
  );
  const base = order.baseCurrency;
  const fieldLabel = (key: string) => (t.has(`fields.${key}`) ? t(`fields.${key}`) : key);
  const statusLabel = (s: string | null) => (s && t.has(`status.${s}`) ? t(`status.${s}`) : (s ?? ""));

  return (
    <main>
      <p>
        <Link href="/panel/orders">{t("back")}</Link>
      </p>
      <h1>{t("detailTitle", { name: order.customerName })}</h1>
      <p className="row-card order-head">
        <span className={`badge status-${order.status}`}>{tAll(`panel.orders.status.${order.status}`)}</span>
        <span>{t("createdAt", { when: when(order.createdAt) })}</span>
      </p>
      {overdue && <p className="badge warn">{t("overdue", { hours: REVIEW_ALERT_HOURS })}</p>}
      {order.holdExpiresAt && order.status === "awaiting_deposit" && (
        <p>{t("deadline", { when: when(order.holdExpiresAt) })}</p>
      )}

      <section aria-labelledby="customer-title">
        <h2 id="customer-title">{t("customer")}</h2>
        <dl className="facts">
          <Fact label={t("customerName")}>{order.customerName}</Fact>
          <Fact label={t("customerPhone")}>
            <a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a>
          </Fact>
          {Object.entries(order.fields).map(([key, value]) => (
            <Fact key={key} label={fieldLabel(key)}>
              {value}
            </Fact>
          ))}
        </dl>
      </section>

      <section aria-labelledby="lines-title">
        <h2 id="lines-title">{t("lines")}</h2>
        <ul className="cards">
          {order.lines.map((line) => {
            const s = line.snapshot;
            const variant = lineText(s.variantLabel, lang);
            const extras = [...(s.meats ?? []), ...(s.toppings ?? [])];
            return (
              <li key={line.position} className="card">
                <div className="row-card">
                  <strong>
                    {line.qty} × {lineText(s.name, lang) || t("unnamed")}
                    {variant && ` · ${variant}`}
                  </strong>
                  <span>{s.pendingQuote ? moneyOrPending(null, order.currency, lang) : moneyOrPending(line.totalMinor, order.currency, lang)}</span>
                </div>
                {typeof s.people === "number" && <p className="hint">{t("people", { count: s.people })}</p>}
                {extras.length > 0 && <p className="hint">{t("extras", { list: extras.join(", ") })}</p>}
                {s.start ? (
                  <p className="hint">{t("slot", { when: when(s.start) })}</p>
                ) : (
                  s.date && <p className="hint">{t("date", { date: s.date })}</p>
                )}
                {s.pendingQuote && <p className="hint">{t("pendingQuoteLine")}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="money-title">
        <h2 id="money-title">{t("amounts")}</h2>
        <dl className="facts">
          <Fact label={t("subtotal")}>{money.subtotal}</Fact>
          <Fact label={t("shipping")}>{money.shipping}</Fact>
          <Fact label={t("total")}>
            <strong>{money.total}</strong>
          </Fact>
          <Fact label={t("depositDue")}>{money.depositDue}</Fact>
          <Fact label={t("dueOnDelivery")}>{money.dueOnDelivery}</Fact>
        </dl>
        {order.shippingPrepay && <p className="hint">{t("prepayNote")}</p>}
      </section>

      <section aria-labelledby="proofs-title">
        <h2 id="proofs-title">{t("proofs")}</h2>
        {proofs.length === 0 ? (
          <p>{t("noProofs")}</p>
        ) : (
          <ul className="cards">
            {proofs.map((p, i) => (
              <li key={p.id} className="card">
                <div className="row-card">
                  <strong>{t("proofN", { n: i + 1 })}</strong>
                  <span className={`badge proof-${p.status}`}>{t(`proofStatus.${p.status}`)}</span>
                </div>
                <p className="hint">{when(p.createdAt)}</p>
                {p.reason && <p>{t("rejectedBecause", { reason: p.reason })}</p>}
                {p.url ? (
                  <>
                    {p.contentType.startsWith("image/") && (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file; next/image would cache it
                      <img className="proof-image" src={p.url} alt={t("proofAlt", { n: i + 1 })} referrerPolicy="no-referrer" />
                    )}
                    <p>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        {t("openProof")}
                      </a>
                    </p>
                    <p className="hint">{t("proofLinkHint")}</p>
                  </>
                ) : (
                  <p className="error">{t("proofUnavailable")}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="actions-title">
        <h2 id="actions-title">{t("actionsTitle")}</h2>
        {actions.length === 0 && <p>{t("noActions")}</p>}

        {actions.includes("set_shipping") && (
          <div className="card action">
            <h3>{t("actions.set_shipping")}</h3>
            <PanelForm action={setShippingAction} submitLabel={t("saveShipping")}>
              <Hidden name="id" value={order.id} />
              <Field
                name="amount"
                label={t("shippingFee", { currency: base })}
                hint={t(order.currency === base ? "amountHint" : "amountHintConverted", { currency: base, orderCurrency: order.currency })}
                inputMode="decimal"
                required
              />
            </PanelForm>
          </div>
        )}

        {order.status === "pending_quote" && unpriced > 1 && (
          <p className="hint" role="note">{t("multipleUnpriced")}</p>
        )}

        {actions.includes("set_price") && (
          <div className="card action">
            <h3>{t("actions.set_price")}</h3>
            <p className="hint">{t("priceIntro")}</p>
            <PanelForm action={setPriceAction} submitLabel={t("savePrice")}>
              <Hidden name="id" value={order.id} />
              <Field
                name="amount"
                label={t("quotedPrice", { currency: base })}
                hint={t(order.currency === base ? "amountHint" : "amountHintConverted", { currency: base, orderCurrency: order.currency })}
                inputMode="decimal"
                required
              />
            </PanelForm>
          </div>
        )}

        {actions.includes("approve") && (
          <div className="card action">
            <h3>{hasPendingProof ? t("actions.approve") : t("confirmOrder")}</h3>
            <p className="hint">{hasPendingProof ? t("approveIntro") : t("confirmIntro")}</p>
            <PanelForm
              action={approveAction}
              submitLabel={hasPendingProof ? t("approve") : t("confirmOrder")}
              confirmText={hasPendingProof ? t("approveConfirm") : t("confirmOrderConfirm")}
            >
              <Hidden name="id" value={order.id} />
            </PanelForm>
          </div>
        )}

        {actions.includes("reject") && (
          <div className="card action">
            <h3>{t("actions.reject")}</h3>
            <p className="hint">{t("rejectIntro")}</p>
            <PanelForm action={rejectAction} submitLabel={t("reject")} danger>
              <Hidden name="id" value={order.id} />
              <TextArea name="reason" label={t("reason")} hint={t("rejectReasonHint")} required />
            </PanelForm>
          </div>
        )}

        {actions.includes("cancel") && (
          <div className="card action">
            <h3>{t("actions.cancel")}</h3>
            <p className={order.status === "confirmed" ? "alert" : "hint"}>
              {order.status === "confirmed" ? t("cancelConfirmedWarning") : t("cancelIntro")}
            </p>
            <PanelForm
              action={cancelAction}
              submitLabel={t("cancel")}
              confirmText={order.status === "confirmed" ? t("cancelConfirmedConfirm") : t("cancelConfirm")}
              danger
            >
              <Hidden name="id" value={order.id} />
              <TextArea name="reason" label={t("reason")} hint={t("cancelReasonHint")} required />
            </PanelForm>
          </div>
        )}
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title">{t("history")}</h2>
        <ol className="history">
          {order.events.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="hint">{when(e.at)}</span>{" "}
              <span>
                {e.fromStatus
                  ? t("eventChange", { from: statusLabel(e.fromStatus), to: statusLabel(e.toStatus) })
                  : t("eventCreated", { to: statusLabel(e.toStatus) })}
              </span>{" "}
              <span className="hint">({t(`actor.${actorKind(e.actor)}`)})</span>
              {e.reason && <p className="event-reason">{t("eventReason", { reason: e.reason })}</p>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
