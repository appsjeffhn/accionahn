"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Field, FieldError, Hidden, PanelForm, Select, TextArea } from "../form-kit";
import type { FormState } from "../form-state";
import type { EditorInitial } from "./initial";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

// Row lists keep a stable number per row; the number is part of the field names
// ("tiers.3.price"), so errors come back on the right row after rows are removed.
function useRows<T>(initial: T[]) {
  const [state, setState] = useState(() => ({
    next: initial.length,
    rows: initial.map((data, n) => ({ n, data: data as T | null })),
  }));
  return {
    rows: state.rows,
    add: (data: T | null = null) =>
      setState((s) => ({ next: s.next + 1, rows: [...s.rows, { n: s.next, data }] })),
    remove: (n: number) => setState((s) => ({ ...s, rows: s.rows.filter((row) => row.n !== n) })),
  };
}

export function ProductEditor({
  action,
  initial,
  baseCurrency,
  extraCurrencies,
  newVariantIds,
}: {
  action: Action;
  initial: EditorInitial;
  baseCurrency: string;
  extraCurrencies: string[];
  // Generated once when the page was rendered, so a retried save updates instead of duplicating.
  newVariantIds: string[];
}) {
  const t = useTranslations("panel.editor");
  const [kind, setKind] = useState(initial.kind);
  const [reservable, setReservable] = useState(initial.reservable);
  const [depositKind, setDepositKind] = useState(initial.depositKind);
  const variants = useRows<{ id: string; existing: EditorInitial["variants"][number] | null }>(
    initial.variants.map((v) => ({ id: v.id, existing: v })),
  );
  const [unusedIds, setUnusedIds] = useState(newVariantIds);
  const tiers = useRows(initial.tiers);
  const meats = useRows(initial.meats);
  const toppings = useRows(initial.toppings);
  const money = t("moneyHint", { currency: baseCurrency });

  return (
    <PanelForm action={action} submitLabel={t("save")}>
      <Hidden name="id" value={initial.id} />

      <fieldset>
        <legend>{t("basics")}</legend>
        <Field name="name.es" label={t("nameEs")} defaultValue={initial.name.es} required />
        <Field name="name.en" label={t("nameEn")} defaultValue={initial.name.en} required />
        <TextArea name="description.es" label={t("descriptionEs")} defaultValue={initial.description.es} required />
        <TextArea name="description.en" label={t("descriptionEn")} defaultValue={initial.description.en} required />
        <Select
          name="kind"
          label={t("kind")}
          defaultValue={initial.kind}
          hint={t("kindHint")}
          onChange={(v) => setKind(v === "configurable" ? "configurable" : "simple")}
          options={[
            { value: "simple", label: t("kindSimple") },
            { value: "configurable", label: t("kindConfigurable") },
          ]}
        />
        <Check
          name="reservable"
          label={t("reservable")}
          hint={t("reservableHint")}
          defaultChecked={initial.reservable}
          onChange={setReservable}
        />
        <Check name="active" label={t("active")} hint={t("activeHint")} defaultChecked={initial.active} />
      </fieldset>

      <fieldset>
        <legend>{t("pricing")}</legend>
        <Field
          name="price"
          label={kind === "configurable" ? t("priceConfigurable", { currency: baseCurrency }) : t("price", { currency: baseCurrency })}
          hint={money}
          inputMode="decimal"
          defaultValue={initial.price}
          required
        />
        {extraCurrencies.map((code) => (
          <Field
            key={code}
            name={`fixedPrice.${code}`}
            label={t("fixedPrice", { currency: code })}
            hint={t("fixedPriceHint", { currency: code })}
            inputMode="decimal"
            defaultValue={initial.fixedPrices[code] ?? ""}
          />
        ))}
        <Select
          name="deposit.kind"
          label={t("deposit")}
          defaultValue={initial.depositKind}
          onChange={(v) => setDepositKind(v as EditorInitial["depositKind"])}
          options={[
            { value: "none", label: t("depositNone") },
            { value: "percent", label: t("depositPercent") },
            { value: "fixed", label: t("depositFixed", { currency: baseCurrency }) },
            { value: "full", label: t("depositFull") },
          ]}
        />
        {(depositKind === "percent" || depositKind === "fixed") && (
          <Field
            name="deposit.value"
            label={depositKind === "percent" ? t("depositPercentValue") : t("depositFixedValue", { currency: baseCurrency })}
            hint={depositKind === "percent" ? t("depositPercentHint") : money}
            inputMode="decimal"
            defaultValue={initial.depositValue}
          />
        )}
      </fieldset>

      {kind === "configurable" && (
        <fieldset>
          <legend>{t("tiers")}</legend>
          <p className="hint">{t("tiersHint")}</p>
          <FieldError name="tiers" />
          {tiers.rows.map(({ n, data }, i) => (
            <div key={n} className="row-group" role="group" aria-label={t("tierN", { n: i + 1 })}>
              <Field name={`tiers.${n}.minPeople`} label={t("minPeople")} type="number" min="1" step="1" defaultValue={data?.minPeople} />
              <Field name={`tiers.${n}.maxPeople`} label={t("maxPeople")} type="number" min="1" step="1" defaultValue={data?.maxPeople} />
              <Field name={`tiers.${n}.price`} label={t("pricePerPerson", { currency: baseCurrency })} inputMode="decimal" defaultValue={data?.price} />
              <Field name={`tiers.${n}.includedMeats`} label={t("includedMeats")} type="number" min="0" step="1" defaultValue={data?.includedMeats ?? "0"} />
              <Field name={`tiers.${n}.includedToppings`} label={t("includedToppings")} type="number" min="0" step="1" defaultValue={data?.includedToppings ?? "0"} />
              <FieldError name={`tiers.${n}`} />
              <button type="button" className="link" onClick={() => tiers.remove(n)}>
                {t("removeTier", { n: i + 1 })}
              </button>
            </div>
          ))}
          <button type="button" onClick={() => tiers.add()}>
            {t("addTier")}
          </button>
          {(["meats", "toppings"] as const).map((list) => {
            const rows = list === "meats" ? meats : toppings;
            return (
              <div key={list} className="sublist">
                <h3>{t(list)}</h3>
                <p className="hint">{t(`${list}Hint`)}</p>
                <FieldError name={list} />
                {rows.rows.map(({ n, data }, i) => (
                  <div key={n} className="row-group" role="group" aria-label={t(`${list}N`, { n: i + 1 })}>
                    <Field name={`${list}.${n}.id`} label={t("optionName")} defaultValue={data?.id} />
                    <Field name={`${list}.${n}.price`} label={t("extraPrice", { currency: baseCurrency })} inputMode="decimal" defaultValue={data?.price ?? "0"} />
                    <button type="button" className="link" onClick={() => rows.remove(n)}>
                      {t("removeOption", { n: i + 1 })}
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => rows.add()}>
                  {t(list === "meats" ? "addMeat" : "addTopping")}
                </button>
              </div>
            );
          })}
        </fieldset>
      )}

      <fieldset>
        <legend>{t("variants")}</legend>
        <p className="hint">{t("variantsHint")}</p>
        {variants.rows.map(({ n, data }, i) => {
          const existing = data?.existing ?? null;
          return (
            <div key={n} className="row-group" role="group" aria-label={t("variantN", { n: i + 1 })}>
              <Hidden name={`variants.${n}.id`} value={data?.id ?? ""} />
              {!existing && <Hidden name={`variants.${n}.new`} value="1" />}
              <Field name={`variants.${n}.label.es`} label={t("variantEs")} defaultValue={existing?.labelEs} required />
              <Field name={`variants.${n}.label.en`} label={t("variantEn")} defaultValue={existing?.labelEn} required />
              <Field name={`variants.${n}.sku`} label={t("sku")} defaultValue={existing?.sku} />
              <Check name={`variants.${n}.active`} label={t("variantActive")} defaultChecked={existing ? existing.active : true} />
              {existing ? (
                <p className="hint">
                  {existing.stock === null ? t("stockUntracked") : t("stockCurrent", { stock: existing.stock })}
                </p>
              ) : (
                <>
                  <Check name={`variants.${n}.track`} label={t("trackStock")} hint={t("trackStockHint")} defaultChecked />
                  <Field name={`variants.${n}.stock`} label={t("initialStock")} type="number" min="0" step="1" defaultValue="0" />
                </>
              )}
              <button type="button" className="link" onClick={() => variants.remove(n)}>
                {existing ? t("removeVariantExisting", { n: i + 1 }) : t("removeVariant", { n: i + 1 })}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={unusedIds.length === 0}
          onClick={() => {
            const [id, ...rest] = unusedIds;
            if (!id) return;
            setUnusedIds(rest);
            variants.add({ id, existing: null });
          }}
        >
          {t("addVariant")}
        </button>
      </fieldset>

      {reservable && (
        <fieldset>
          <legend>{t("booking")}</legend>
          <p className="hint">{t("bookingHint")}</p>
          <Field name="calendar.prepMinutes" label={t("prepMinutes")} type="number" min="0" step="1" defaultValue={initial.calendar.prepMinutes} />
          <Field name="calendar.serviceMinutes" label={t("serviceMinutes")} type="number" min="1" step="1" defaultValue={initial.calendar.serviceMinutes} required />
          <Field name="calendar.bufferMinutes" label={t("bufferMinutes")} hint={t("bufferHint")} type="number" min="0" step="1" defaultValue={initial.calendar.bufferMinutes} />
          <Field name="calendar.slotStepMinutes" label={t("slotStep")} hint={t("slotStepHint")} type="number" min="5" step="5" defaultValue={initial.calendar.slotStepMinutes} />
          <Field name="calendar.dailyLimit" label={t("dailyLimit")} hint={t("dailyLimitHint")} type="number" min="1" step="1" defaultValue={initial.calendar.dailyLimit} />
          <Field name="calendar.minNoticeHours" label={t("minNotice")} type="number" min="0" step="1" defaultValue={initial.calendar.minNoticeHours} />
          <Field name="calendar.maxDaysAhead" label={t("maxDaysAhead")} type="number" min="0" step="1" defaultValue={initial.calendar.maxDaysAhead} />
        </fieldset>
      )}
    </PanelForm>
  );
}
