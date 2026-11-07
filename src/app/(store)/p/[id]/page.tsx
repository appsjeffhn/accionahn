import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listDaySlots, type DaySlots } from "@/lib/calendar/calendar";
import { formatMoney } from "@/lib/pricing/money";
import type { ConfigurableDef, Deposit } from "@/lib/pricing/types";
import { resolveImageSource } from "@/lib/store/assets";
import { addDays, dayParam, formatDay, formatTime, isUuid, localized, todayIn } from "@/lib/store/view";
import { addToCartAction } from "../../actions";
import { storeContext } from "../../store-context";
import { RadioGroupError, StoreForm } from "../../store-forms";
import { TaqueadaSelector } from "../../taqueada-selector";

export const dynamic = "force-dynamic";

// How far ahead the day picker offers; the calendar's own max_days_ahead still applies.
const PICKER_DAYS = 365;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return {};
  const { catalog, locale } = await storeContext();
  const product = catalog.products.find((p) => p.id === id);
  return product ? { title: localized(product.name, locale) } : {};
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(id)) notFound();
  const [ctx, t] = await Promise.all([storeContext(), getTranslations("store")]);
  const { catalog, locale, tenant, settings } = ctx;
  const product = catalog.products.find((p) => p.id === id);
  if (!product) notFound();

  const money = (minor: number) => formatMoney(minor, tenant.baseCurrency, locale);
  const name = localized(product.name, locale) || t("unnamed");
  const description = localized(product.description, locale);
  // Only images under this tenant's Storage prefix are rendered; others are left out.
  const image = Array.isArray(product.images) ? resolveImageSource(ctx.tenantId, product.images[0], ctx.storageUrl) : null;
  const variants = catalog.variants.filter((v) => v.product_id === id);
  const configurable = product.kind === "configurable" ? (product.configurable as ConfigurableDef | null) : null;

  // One slot per line: the customer picks the day here; otherwise at checkout.
  const slotHere = product.reservable === true && settings.perLineDate;
  const today = todayIn(settings.timezone);
  const day = slotHere ? dayParam(query.day) : null;
  const listed: DaySlots = day && day >= today ? await listDaySlots(ctx.tenantId, id, day) : { slots: [], full: false, prepMinutes: 0 };
  const slots = listed.slots;

  return (
    <article className="store-product">
      <h1>{name}</h1>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- only the tenant's own Storage images (resolveImageSource); next/image would need the host allowlisted per project
        <img src={image} alt="" />
      )}
      {description && <p>{description}</p>}

      {configurable ? (
        <section aria-labelledby="tiers-title">
          <h2 id="tiers-title">{t("taqueada.pricesTitle")}</h2>
          <ul>
            {[...configurable.tiers]
              .sort((a, b) => a.minPeople - b.minPeople)
              .map((tier) => (
                <li key={`${tier.minPeople}-${tier.maxPeople}`}>
                  {t("taqueada.tierLine", {
                    min: tier.minPeople,
                    max: tier.maxPeople,
                    price: money(tier.pricePerPersonMinor),
                    meats: tier.includedMeats,
                    toppings: tier.includedToppings,
                  })}
                </li>
              ))}
          </ul>
        </section>
      ) : (
        <p className="store-price">{money(Number(product.price_minor))}</p>
      )}

      {product.reservable === true && !settings.perLineDate && <p className="store-hint">{t("slots.atCheckout")}</p>}

      {slotHere && (
        <form method="get" className="store-inline-form" aria-label={t("slots.pickDay")}>
          <div className="store-field">
            <label htmlFor="day">{t("slots.day")}</label>
            <input id="day" name="day" type="date" min={today} max={addDays(today, PICKER_DAYS)} defaultValue={day ?? ""} required />
          </div>
          <button type="submit" className="store-button-quiet">
            {t("slots.show")}
          </button>
        </form>
      )}

      <StoreForm action={addToCartAction} submitLabel={t("product.add")}>
        {configurable ? (
          <TaqueadaSelector
            productId={id}
            def={configurable}
            deposit={product.deposit as Deposit}
            currency={tenant.baseCurrency}
            locale={locale}
          />
        ) : (
          <>
            <input type="hidden" name="productId" value={id} />
            {variants.length > 0 && (
              <RadioGroupError name="variantId" legend={t("product.variant")}>
                <ul className="store-options">
                  {variants.map((v, i) => (
                    <li key={v.id as string}>
                      <label className="store-check">
                        <input
                          type="radio"
                          name="variantId"
                          value={v.id as string}
                          disabled={!v.inStock}
                          defaultChecked={i === variants.findIndex((x) => x.inStock)}
                          required
                        />
                        <span>{localized(v.label, locale)}</span>
                        {!v.inStock && <span className="store-badge">{t("soldOut")}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </RadioGroupError>
            )}
            <div className="store-field">
              <label htmlFor="qty">{t("product.qty")}</label>
              <input id="qty" name="qty" type="number" inputMode="numeric" min={1} max={99} step={1} defaultValue={1} required />
            </div>
          </>
        )}

        {slotHere &&
          (day === null ? (
            <p className="store-notice">{t("slots.pickDayFirst")}</p>
          ) : slots.length === 0 ? (
            <p className="store-notice">{t("slots.none", { day: formatDay(day, locale) })}</p>
          ) : (
            <RadioGroupError name="start" legend={t("slots.legend", { day: formatDay(day, locale) })}>
              <ul className="store-slots">
                {slots.map((s) => (
                  <li key={s.start}>
                    <label className="store-check">
                      <input type="radio" name="start" value={s.start} required />
                      <span>{formatTime(s.start, locale, settings.timezone)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              {listed.prepMinutes > 0 && <p className="store-hint">{t("slots.prepHint", { prep: listed.prepMinutes })}</p>}
            </RadioGroupError>
          ))}
      </StoreForm>
    </article>
  );
}
