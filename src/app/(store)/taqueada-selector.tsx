"use client";

import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { computeQuote } from "@/lib/pricing/engine";
import { formatMoney } from "@/lib/pricing/money";
import type { ConfigurableDef, Deposit, OptionDef } from "@/lib/pricing/types";
import { isAboveLastTier, optionsProblem, tierFor } from "@/lib/store/taqueada";
import { FieldError, useFieldA11y } from "./store-forms";

type Locale = "es" | "en";

// Guided selector of a configurable product: people, the included meats and toppings
// (exactly the tier's count) and paid extras. The live total runs the same pricing engine
// the order uses, for display only; the server prices the order again from the catalog.
export function TaqueadaSelector({
  productId,
  def,
  deposit,
  currency,
  locale,
}: {
  productId: string;
  def: ConfigurableDef;
  deposit: Deposit;
  currency: string;
  locale: Locale;
}) {
  const t = useTranslations("store.taqueada");
  const te = useTranslations("store.errors");
  const minPeople = def.tiers.reduce((m, tier) => Math.min(m, tier.minPeople), Number.POSITIVE_INFINITY);
  const [peopleText, setPeopleText] = useState(String(Number.isFinite(minPeople) ? minPeople : 1));
  const [meats, setMeats] = useState<string[]>([]);
  const [extraMeats, setExtraMeats] = useState<string[]>([]);
  const [toppings, setToppings] = useState<string[]>([]);
  const [extraToppings, setExtraToppings] = useState<string[]>([]);
  const people = /^\d{1,6}$/.test(peopleText) ? Number(peopleText) : NaN;
  const tier = Number.isInteger(people) && people > 0 ? tierFor(def, people) : undefined;
  const aboveLast = Number.isInteger(people) && isAboveLastTier(def, people);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const peopleA11y = useFieldA11y("people");

  const summary = useMemo(() => {
    if (!tier) return { error: "invalid_people" as const };
    const problem =
      optionsProblem([...meats, ...extraMeats], meats.length, def.meats, tier.includedMeats) ??
      optionsProblem([...toppings, ...extraToppings], toppings.length, def.toppings, tier.includedToppings);
    const quote = computeQuote({
      currency,
      baseCurrency: currency,
      rates: {},
      products: [{ id: productId, kind: "configurable", priceMinor: 0, fixedPrices: {}, configurable: def, deposit }],
      lines: [{ lineId: "x", productId, qty: 1, people, meats: [...meats, ...extraMeats], toppings: [...toppings, ...extraToppings] }],
      dateRules: [],
      shipping: { mode: "none", zones: [], fixedFeeMinor: 0, prepay: false },
    });
    const engineError = quote.errors[0]?.code;
    return { error: problem ?? engineError ?? null, quote };
  }, [tier, meats, extraMeats, toppings, extraToppings, def, currency, productId, deposit, people]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) =>
    set(on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <div className="taqueada">
      <div className="store-field">
        <label htmlFor={peopleA11y.inputId}>{t("people")}</label>
        <input
          id={peopleA11y.inputId}
          name="people"
          type="number"
          inputMode="numeric"
          min={Number.isFinite(minPeople) ? minPeople : 1}
          step={1}
          required
          value={peopleText}
          onChange={(e) => setPeopleText(e.target.value)}
          aria-invalid={peopleA11y.invalid || undefined}
          aria-describedby={peopleA11y.describedBy}
        />
        <FieldError id={peopleA11y.errorId} name="people" />
        {tier && !aboveLast && (
          <p className="store-hint">
            {t("tierInfo", {
              price: money(tier.pricePerPersonMinor),
              meats: tier.includedMeats,
              toppings: tier.includedToppings,
            })}
          </p>
        )}
        {aboveLast && <p className="store-hint">{t("aboveLastTier")}</p>}
      </div>

      {tier && (
        <>
          <OptionGroup
            legend={t("includedMeats", { count: tier.includedMeats })}
            name="meat"
            options={def.meats}
            selected={meats}
            disabled={extraMeats}
            max={tier.includedMeats}
            onToggle={(id, on) => toggle(meats, setMeats, id, on)}
          />
          <OptionGroup
            legend={t("extraMeats")}
            name="extraMeat"
            options={def.meats}
            selected={extraMeats}
            disabled={meats}
            price={money}
            onToggle={(id, on) => toggle(extraMeats, setExtraMeats, id, on)}
          />
          {def.toppings.length > 0 && (
            <>
              <OptionGroup
                legend={t("includedToppings", { count: tier.includedToppings })}
                name="topping"
                options={def.toppings}
                selected={toppings}
                disabled={extraToppings}
                max={tier.includedToppings}
                onToggle={(id, on) => toggle(toppings, setToppings, id, on)}
              />
              <OptionGroup
                legend={t("extraToppings")}
                name="extraTopping"
                options={def.toppings}
                selected={extraToppings}
                disabled={toppings}
                price={money}
                onToggle={(id, on) => toggle(extraToppings, setExtraToppings, id, on)}
              />
            </>
          )}
        </>
      )}

      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="qty" value="1" />

      <div className="store-live" aria-live="polite">
        {summary.error ? (
          <p className="store-field-error">{te(summary.error)}</p>
        ) : aboveLast ? (
          <p>
            <strong>{t("total")}</strong> {t("toBeQuoted")}
          </p>
        ) : summary.quote ? (
          <p>
            <strong>{t("total")}</strong> {money(summary.quote.subtotalMinor)}
            {summary.quote.lines[0] && summary.quote.lines[0].extrasMinor > 0 && (
              <span className="store-hint"> {t("extrasIncluded", { amount: money(summary.quote.lines[0].extrasMinor) })}</span>
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function OptionGroup({
  legend,
  name,
  options,
  selected,
  disabled,
  max,
  price,
  onToggle,
}: {
  legend: string;
  name: string;
  options: OptionDef[];
  selected: string[];
  // chosen in the other group (included vs extra)
  disabled: string[];
  max?: number;
  price?: (minor: number) => string;
  onToggle: (id: string, on: boolean) => void;
}) {
  const id = useId();
  const t = useTranslations("store.taqueada");
  if (max === 0) return null;
  const full = max !== undefined && selected.length >= max;
  return (
    <fieldset className="store-fieldset" aria-describedby={max !== undefined ? `${id}-count` : undefined}>
      <legend>{legend}</legend>
      {max !== undefined && (
        <p id={`${id}-count`} className="store-hint">
          {t("chosen", { count: selected.length, max })}
        </p>
      )}
      <ul className="store-options">
        {options.map((o) => {
          const checked = selected.includes(o.id);
          const off = disabled.includes(o.id) || (!checked && full);
          return (
            <li key={o.id}>
              <label className="store-check">
                <input
                  type="checkbox"
                  name={name}
                  value={o.id}
                  checked={checked}
                  disabled={off}
                  onChange={(e) => onToggle(o.id, e.target.checked)}
                />
                <span>{o.id}</span>
                {price && <span className="store-price-tag">+{price(o.extraPriceMinor)}</span>}
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
