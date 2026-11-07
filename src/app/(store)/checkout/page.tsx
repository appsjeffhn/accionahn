import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { canCheckout, cartIssues, quoteForDisplay } from "@/lib/cart/cart";
import { listDaySlots } from "@/lib/calendar/calendar";
import { formatMoney } from "@/lib/pricing/money";
import { inputFields } from "@/lib/store/checkout";
import { addDays, commonStarts, dayParam, formatDay, formatTime, isUuid, localized, todayIn } from "@/lib/store/view";
import { checkoutAction } from "../actions";
import { Breakdown, CartLines, type ShippingView } from "../cart-view";
import { readCart, storeContext } from "../store-context";
import { RadioGroupError, StoreForm, TextField } from "../store-forms";

export const dynamic = "force-dynamic";

const PICKER_DAYS = 365;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("store"))("checkout.title") };
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ctx, cart, query, t] = await Promise.all([storeContext(), readCart(), searchParams, getTranslations("store")]);
  const { catalog, settings, tenant, locale } = ctx;
  if (cart.lines.length === 0 || cartIssues(cart, catalog).length > 0) redirect("/cart");
  const opts = { locale, currency: tenant.baseCurrency, timezone: settings.timezone };
  const money = (minor: number) => formatMoney(minor, tenant.baseCurrency, locale);

  // Delivery zone: only one of the store's zones counts.
  const zoneRaw = Array.isArray(query.zone) ? query.zone[0] : query.zone;
  const zone = settings.mode === "zones" && isUuid(zoneRaw) ? catalog.zones.find((z) => z.id === zoneRaw) : undefined;
  const zoneId = zone ? (zone.id as string) : undefined;

  // One date for the whole order: a slot every reservable product of the cart offers.
  const reservableIds = [
    ...new Set(
      cart.lines
        .map((l) => l.productId)
        .filter((id) => catalog.products.some((p) => p.id === id && p.reservable === true)),
    ),
  ];
  const needsOrderSlot = !settings.perLineDate && reservableIds.length > 0;
  const today = todayIn(settings.timezone);
  const dayRaw = dayParam(query.day);
  const day = needsOrderSlot && dayRaw && dayRaw >= today ? dayRaw : null;
  const listed = day ? await Promise.all(reservableIds.map((id) => listDaySlots(ctx.tenantId, id, day))) : [];
  const starts = day ? commonStarts(listed.map((l) => l.slots)) : [];
  // "our team arrives N min earlier": only when every reservable product shares one prep time
  const preps = [...new Set(listed.map((l) => l.prepMinutes))];
  const prepHint = preps.length === 1 && preps[0] > 0 ? preps[0] : null;

  const quote = quoteForDisplay(cart, catalog, {
    baseCurrency: tenant.baseCurrency,
    rates: ctx.rates,
    zoneId,
    orderDay: day ?? undefined,
  });
  const shipping: ShippingView =
    settings.mode === "none"
      ? { kind: "none" }
      : settings.mode === "approval"
        ? { kind: "toConfirm" }
        : settings.mode === "zones" && !zoneId
          ? { kind: "chooseZone" }
          : { kind: "amount", minor: quote.shipping.minor };

  const zoneMissing = settings.mode === "zones" && !zoneId;
  const slotMissing = needsOrderSlot && (day === null || starts.length === 0);
  const ready = !zoneMissing && !slotMissing && canCheckout(cart, catalog, quote);
  const fields = inputFields(ctx.orderFields, needsOrderSlot);
  const hasChoices = settings.mode === "zones" || needsOrderSlot;

  return (
    <>
      <h1>{t("checkout.title")}</h1>

      {hasChoices && (
        <section aria-labelledby="delivery-title">
          <h2 id="delivery-title">{t("checkout.delivery")}</h2>
          <form method="get" className="store-inline-form">
            {settings.mode === "zones" && (
              <div className="store-field">
                <label htmlFor="zone">{t("checkout.zone")}</label>
                <select id="zone" name="zone" defaultValue={zoneId ?? ""} required>
                  <option value="" disabled>
                    {t("checkout.chooseZone")}
                  </option>
                  {catalog.zones.map((z) => (
                    <option key={z.id as string} value={z.id as string}>
                      {localized(z.label, locale)} · {money(Number(z.fee_minor))}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {needsOrderSlot && (
              <div className="store-field">
                <label htmlFor="day">{t("slots.day")}</label>
                <input id="day" name="day" type="date" min={today} max={addDays(today, PICKER_DAYS)} defaultValue={day ?? ""} required />
              </div>
            )}
            <button type="submit" className="store-button-quiet">
              {t("checkout.update")}
            </button>
          </form>
          {needsOrderSlot && day !== null && starts.length === 0 && (
            <p className="store-notice">{t("slots.none", { day: formatDay(day, locale) })}</p>
          )}
        </section>
      )}

      <h2>{t("checkout.yourOrder")}</h2>
      <CartLines cart={cart} catalog={catalog} quote={quote} issues={[]} opts={opts} />
      <Breakdown quote={quote} shipping={shipping} opts={opts} />

      <h2>{t("checkout.confirmTitle")}</h2>
      {!ready ? (
        <p className="store-notice">
          {zoneMissing ? t("checkout.zoneFirst") : slotMissing ? t("checkout.dayFirst") : t("cart.fixFirst")}
        </p>
      ) : (
        <StoreForm action={checkoutAction} submitLabel={t("checkout.submit")}>
          {zoneId && <input type="hidden" name="zoneId" value={zoneId} />}
          {needsOrderSlot && day && (
            <RadioGroupError name="start" legend={t("slots.legend", { day: formatDay(day, locale) })}>
              <ul className="store-slots">
                {starts.map((start) => (
                  <li key={start}>
                    <label className="store-check">
                      <input type="radio" name="start" value={start} required />
                      <span>{formatTime(start, locale, settings.timezone)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </RadioGroupError>
          )}
          {needsOrderSlot && day && prepHint !== null && (
            <p className="store-hint">{t("slots.prepHint", { prep: prepHint })}</p>
          )}
          <TextField name="name" label={t("fields.name")} required autoComplete="name" />
          <TextField name="phone" label={t("fields.phone")} type="tel" required autoComplete="tel" inputMode="tel" hint={t("fields.phoneHint")} />
          {fields.map((f) => (
            <TextField
              key={f.key}
              name={`field.${f.key}`}
              label={t(`fields.${f.key}`)}
              required={f.required}
              type={f.key === "date" ? "date" : f.key === "time" ? "time" : "text"}
              multiline={f.key === "address"}
              autoComplete={f.key === "address" ? "street-address" : undefined}
              min={f.key === "date" ? today : undefined}
            />
          ))}
          <TextField name="field.notes" label={t("fields.notes")} multiline />
          <p className="store-hint">{t("checkout.pricesNote")}</p>
        </StoreForm>
      )}
      <p>
        <Link href="/cart">{t("checkout.backToCart")}</Link>
      </p>
    </>
  );
}
