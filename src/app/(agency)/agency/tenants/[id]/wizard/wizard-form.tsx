"use client";

import { useActionState } from "react";
import { EMPTY_WIZARD_STATE, type WizardState } from "@/lib/agency/wizard-form";


export type WizardLabels = {
  fields: Record<string, string>;
  orderKeys: Record<string, string>;
  // Error key (e.g. "slugInvalid") -> translated text.
  errors: Record<string, string>;
  finish: string;
  title: string;
  currencies: string[];
  orderFieldKeys: string[];
  extraRows: number;
};

export function WizardForm({
  action,
  labels,
}: {
  action: (prev: WizardState, fd: FormData) => Promise<WizardState>;
  labels: WizardLabels;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_WIZARD_STATE);
  const err = (path: string) => {
    const key = state.errors[path];
    if (!key) return null;
    return (
      <p role="alert" style={{ color: "crimson" }}>
        {labels.errors[key] ?? labels.errors.invalid}
      </p>
    );
  };
  const f = labels.fields;
  // React resets uncontrolled fields after an action; re-seed them from what was submitted.
  const v = (name: string, fallback = "") => state.values[name] ?? fallback;
  const checked = (name: string) => state.values[name] === "on";

  return (
    <form action={formAction}>
      <h1>{labels.title}</h1>
      {err("_form")}

      <label>
        {f.name}
        <input name="companyName" required defaultValue={v("companyName")} />
      </label>
      {err("companyName")}

      <label>
        {f.slug}
        <input name="slug" required defaultValue={v("slug")} />
      </label>
      {err("slug")}

      <label>
        {f.defaultLocale}
        <select name="defaultLocale" defaultValue={v("defaultLocale", "es")}>
          <option value="es">Español</option>
          <option value="en">English</option>
        </select>
      </label>
      {err("defaultLocale")}

      <label>
        {f.baseCurrency}
        <select name="baseCurrency" defaultValue={v("baseCurrency", "HNL")}>
          {labels.currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {err("baseCurrency")}

      {Array.from({ length: labels.extraRows }, (_, i) => (
        <fieldset key={i}>
          <legend>{f.extraCurrency}</legend>
          <select name={`extraCode${i}`} defaultValue={v(`extraCode${i}`)}>
            <option value="">{f.none}</option>
            {labels.currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          {err(`extraCurrencies.${i}.code`)}
          <select
            name={`extraMode${i}`}
            defaultValue={v(`extraMode${i}`, "manual")}
            aria-label={f.extraMode}
          >
            <option value="manual">{f.modeManual}</option>
            <option value="rate">{f.modeRate}</option>
          </select>
          {err(`extraCurrencies.${i}.mode`)}
          <input
            name={`extraRate${i}`}
            defaultValue={v(`extraRate${i}`)}
            type="number"
            step="any"
            min="0"
            placeholder={f.rate}
            aria-label={f.rate}
          />
          {err(`extraCurrencies.${i}.rate`)}
        </fieldset>
      ))}

      <label>
        {f.ownerAlertPhone}
        <input
          name="ownerAlertPhone"
          type="tel"
          required
          defaultValue={v("ownerAlertPhone")}
        />
      </label>
      {err("ownerAlertPhone")}

      <fieldset>
        <legend>{f.orderFields}</legend>
        {labels.orderFieldKeys.map((k) => (
          <div key={k}>
            <label>
              <input type="checkbox" name={`field_${k}`} defaultChecked={checked(`field_${k}`)} /> {labels.orderKeys[k]}
            </label>
            <label>
              <input
                type="checkbox"
                name={`required_${k}`}
                defaultChecked={checked(`required_${k}`)}
              /> {f.required}
            </label>
          </div>
        ))}
        {err("orderFields")}
      </fieldset>

      <label>
        {f.whatsappMode}
        <select name="whatsappMode" defaultValue={v("whatsappMode", "evolution")}>
          <option value="evolution">Evolution</option>
          <option value="cloud_api">Cloud API</option>
        </select>
      </label>
      {err("whatsappMode")}

      <label>
        {f.aiCapCents}
        <input
          name="aiCapCents"
          type="number"
          min="0"
          step="1"
          placeholder="500"
          defaultValue={v("aiCapCents")}
        />
      </label>
      {err("aiCapCents")}

      <label>
        {f.retentionMonths}
        <input
          name="retentionMonths"
          type="number"
          min="1"
          step="1"
          placeholder="12"
          defaultValue={v("retentionMonths")}
        />
      </label>
      {err("retentionMonths")}

      <button type="submit" disabled={pending}>
        {labels.finish}
      </button>
    </form>
  );
}
