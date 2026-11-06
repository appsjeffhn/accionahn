import { randomUUID } from "node:crypto";
import { getLocale, getTranslations } from "next-intl/server";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { formatMinorInput } from "@/lib/catalog/form";
import { formatMoney } from "@/lib/pricing/money";
import { loadTenantCurrencies } from "@/lib/store/setup";
import { Check, Field, FieldError, Hidden, PanelForm, Select, TextArea } from "../form-kit";
import { panelSession } from "../session";
import {
  deleteDateRuleAction,
  deleteZoneAction,
  saveDateRuleAction,
  saveSettingsAction,
  saveZoneAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type Text = { es?: string; en?: string };
type Translate = Awaited<ReturnType<typeof getTranslations>>;

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function DateRuleFields({
  t,
  rule,
  baseCurrency,
  weekdayLabels,
}: {
  t: Translate;
  rule?: Row;
  baseCurrency: string;
  weekdayLabels: string[];
}) {
  const label = (rule?.label ?? {}) as Text;
  const kind = rule?.kind === "percent" ? "percent" : "fixed";
  const value = rule ? (kind === "fixed" ? formatMinorInput(Number(rule.value), baseCurrency) : String(rule.value)) : "";
  const weekdays = (rule?.weekdays ?? []) as number[];
  const dates = (rule?.dates ?? []) as string[];
  return (
    <>
      <Field name="label.es" label={t("labelEs")} defaultValue={label.es} required />
      <Field name="label.en" label={t("labelEn")} defaultValue={label.en} required />
      <Select
        name="kind"
        label={t("ruleKind")}
        defaultValue={kind}
        options={[
          { value: "fixed", label: t("ruleFixed", { currency: baseCurrency }) },
          { value: "percent", label: t("rulePercent") },
        ]}
      />
      <Field name="value" label={t("ruleValue")} hint={t("ruleValueHint", { currency: baseCurrency })} inputMode="decimal" defaultValue={value} required />
      <fieldset>
        <legend>{t("ruleWeekdays")}</legend>
        <div className="checks-inline">
          {WEEKDAYS.map((d) => (
            <Check key={d} name="weekdays" value={String(d)} label={weekdayLabels[d]} defaultChecked={weekdays.includes(d)} />
          ))}
        </div>
        <FieldError name="weekdays" />
      </fieldset>
      <TextArea name="dates" label={t("ruleDates")} hint={t("ruleDatesHint")} defaultValue={dates.join("\n")} rows={2} />
    </>
  );
}

function ZoneFields({ t, zone, baseCurrency }: { t: Translate; zone?: Row; baseCurrency: string }) {
  const label = (zone?.label ?? {}) as Text;
  return (
    <>
      <Field name="label.es" label={t("labelEs")} defaultValue={label.es} required />
      <Field name="label.en" label={t("labelEn")} defaultValue={label.en} required />
      <Field
        name="fee"
        label={t("zoneFee", { currency: baseCurrency })}
        hint={t("moneyHint", { currency: baseCurrency })}
        inputMode="decimal"
        defaultValue={zone ? formatMinorInput(Number(zone.fee_minor), baseCurrency) : ""}
        required
      />
      <Field name="position" label={t("zonePosition")} type="number" min="0" step="1" defaultValue={zone ? String(zone.position) : "0"} />
    </>
  );
}

export default async function SettingsPage() {
  const { session, tenantId } = await panelSession();
  const [catalog, currencies, t, tw, locale] = await Promise.all([
    listOwnerCatalog(session, tenantId),
    loadTenantCurrencies(session),
    getTranslations("panel.settings"),
    getTranslations("panel.weekdays"),
    getLocale(),
  ]);
  const weekdayLabels = [0, 1, 2, 3, 4, 5, 6].map((d) => tw(String(d)));
  const lang = locale === "en" ? "en" : "es";
  const base = currencies.baseCurrency;
  const s = catalog.settings ?? {};
  const instructions = (s.payment_instructions ?? {}) as Text;
  const timezones = Intl.supportedValuesOf("timeZone");
  const newRuleId = randomUUID();
  const newZoneId = randomUUID();
  const text = (v: unknown) => {
    const o = (v ?? {}) as Text;
    return o[lang] || o.es || o.en || "";
  };

  return (
    <main>
      <h1>{t("title")}</h1>

      <section aria-labelledby="store-title">
        <h2 id="store-title">{t("storeTitle")}</h2>
        <PanelForm action={saveSettingsAction} submitLabel={t("save")}>
          <fieldset>
            <legend>{t("shipping")}</legend>
            <Select
              name="shippingMode"
              label={t("shippingMode")}
              defaultValue={String(s.shipping_mode ?? "none")}
              hint={t("shippingModeHint")}
              options={["none", "fixed", "zones", "approval"].map((m) => ({ value: m, label: t(`modes.${m}`) }))}
            />
            <Field
              name="fixedFee"
              label={t("fixedFee", { currency: base })}
              hint={t("fixedFeeHint", { currency: base })}
              inputMode="decimal"
              defaultValue={formatMinorInput(Number(s.fixed_fee_minor ?? 0), base)}
            />
            <Check name="shippingPrepay" label={t("prepay")} hint={t("prepayHint")} defaultChecked={s.shipping_prepay === true} />
          </fieldset>
          <fieldset>
            <legend>{t("orders")}</legend>
            <Field
              name="holdHours"
              label={t("holdHours")}
              hint={t("holdHoursHint")}
              type="number"
              min="1"
              max="168"
              step="1"
              defaultValue={String(s.hold_hours ?? 24)}
              required
            />
            <Check name="perLineDate" label={t("perLineDate")} hint={t("perLineDateHint")} defaultChecked={s.per_line_date === true} />
            <Field
              name="timezone"
              label={t("timezone")}
              hint={t("timezoneHint")}
              list="timezones"
              defaultValue={String(s.timezone ?? "America/Tegucigalpa")}
              autoComplete="off"
              required
            />
            <datalist id="timezones">
              {timezones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </fieldset>
          <fieldset>
            <legend>{t("payment")}</legend>
            <TextArea name="paymentInstructions.es" label={t("instructionsEs")} hint={t("instructionsHint")} defaultValue={instructions.es} rows={4} />
            <TextArea name="paymentInstructions.en" label={t("instructionsEn")} defaultValue={instructions.en} rows={4} />
          </fieldset>
        </PanelForm>
      </section>

      <section aria-labelledby="rules-title">
        <h2 id="rules-title">{t("rulesTitle")}</h2>
        <p className="hint">{t("rulesHint")}</p>
        {catalog.dateRules.length === 0 && <p>{t("rulesEmpty")}</p>}
        <ul className="cards">
          {catalog.dateRules.map((rule) => {
            const id = String(rule.id);
            const value =
              rule.kind === "percent" ? `${Number(rule.value)}%` : formatMoney(Number(rule.value), base, lang);
            return (
              <li key={id} className="card">
                <details>
                  <summary>
                    {text(rule.label)} · +{value}
                  </summary>
                  <PanelForm action={saveDateRuleAction} submitLabel={t("save")}>
                    <Hidden name="id" value={id} />
                    <DateRuleFields t={t} rule={rule} baseCurrency={base} weekdayLabels={weekdayLabels} />
                  </PanelForm>
                  <PanelForm action={deleteDateRuleAction} submitLabel={t("delete")} confirmText={t("deleteConfirm")} danger>
                    <Hidden name="id" value={id} />
                  </PanelForm>
                </details>
              </li>
            );
          })}
        </ul>
        <details className="card">
          <summary>{t("addRule")}</summary>
          <PanelForm key={newRuleId} action={saveDateRuleAction} submitLabel={t("add")}>
            <Hidden name="id" value={newRuleId} />
            <DateRuleFields t={t} baseCurrency={base} weekdayLabels={weekdayLabels} />
          </PanelForm>
        </details>
      </section>

      <section aria-labelledby="zones-title">
        <h2 id="zones-title">{t("zonesTitle")}</h2>
        <p className="hint">{t("zonesHint")}</p>
        {catalog.zones.length === 0 && <p>{t("zonesEmpty")}</p>}
        <ul className="cards">
          {catalog.zones.map((zone) => {
            const id = String(zone.id);
            return (
              <li key={id} className="card">
                <details>
                  <summary>
                    {text(zone.label)} · {formatMoney(Number(zone.fee_minor), base, lang)}
                  </summary>
                  <PanelForm action={saveZoneAction} submitLabel={t("save")}>
                    <Hidden name="id" value={id} />
                    <ZoneFields t={t} zone={zone} baseCurrency={base} />
                  </PanelForm>
                  <PanelForm action={deleteZoneAction} submitLabel={t("delete")} confirmText={t("deleteConfirm")} danger>
                    <Hidden name="id" value={id} />
                  </PanelForm>
                </details>
              </li>
            );
          })}
        </ul>
        <details className="card">
          <summary>{t("addZone")}</summary>
          <PanelForm key={newZoneId} action={saveZoneAction} submitLabel={t("add")}>
            <Hidden name="id" value={newZoneId} />
            <ZoneFields t={t} baseCurrency={base} />
          </PanelForm>
        </details>
      </section>
    </main>
  );
}
