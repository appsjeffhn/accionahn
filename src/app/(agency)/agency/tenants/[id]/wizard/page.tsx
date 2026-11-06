import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getSession, requireRole } from "@/lib/auth/session";
import { wizardFormToInput, EXTRA_CURRENCY_ROWS } from "@/lib/agency/wizard-form";
import {
  ORDER_FIELD_KEYS,
  SUPPORTED_CURRENCIES,
  wizardInputSchema,
} from "@/lib/agency/wizard-schema";
import {
  completeWizard,
  SlugTakenError,
  WizardStateError,
} from "@/lib/agency/wizard";
import { WizardForm, type WizardState } from "./wizard-form";

export const dynamic = "force-dynamic";

const ERROR_KEYS = [
  "invalid",
  "required",
  "slugInvalid",
  "slugReserved",
  "slugTaken",
  "currencyInvalid",
  "currencyDuplicate",
  "rateInvalid",
  "phoneInvalid",
  "notPending",
] as const;

// Schema messages are i18n keys ("wizard.errors.slugInvalid"); keep the last segment.
const errorKey = (message: string) => message.replace(/^wizard\.errors\./, "");

export default async function WizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  requireRole(await getSession(), "agency_admin");
  const { id } = await params;
  const t = await getTranslations("wizard");

  async function submit(_prev: WizardState, formData: FormData): Promise<WizardState> {
    "use server";
    requireRole(await getSession(), "agency_admin");
    const parsed = wizardInputSchema.safeParse(wizardFormToInput(formData));
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "_form";
        errors[path] ??= errorKey(issue.message);
      }
      return { errors };
    }
    try {
      await completeWizard(id, parsed.data);
    } catch (error) {
      if (error instanceof SlugTakenError) return { errors: { slug: "slugTaken" } };
      if (error instanceof WizardStateError) return { errors: { _form: "notPending" } };
      throw error;
    }
    redirect("/agency");
  }

  return (
    <main>
      <WizardForm
        action={submit}
        labels={{
          title: t("title"),
          finish: t("finish"),
          fields: Object.fromEntries(
            [
              "name",
              "slug",
              "defaultLocale",
              "baseCurrency",
              "extraCurrency",
              "extraMode",
              "modeManual",
              "modeRate",
              "rate",
              "ownerAlertPhone",
              "orderFields",
              "required",
              "whatsappMode",
              "aiCapCents",
              "retentionMonths",
              "none",
            ].map((k) => [k, t(`fields.${k}`)]),
          ),
          orderKeys: Object.fromEntries(
            ORDER_FIELD_KEYS.map((k) => [k, t(`orderKeys.${k}`)]),
          ),
          errors: Object.fromEntries(ERROR_KEYS.map((k) => [k, t(`errors.${k}`)])),
          currencies: [...SUPPORTED_CURRENCIES],
          orderFieldKeys: [...ORDER_FIELD_KEYS],
          extraRows: EXTRA_CURRENCY_ROWS,
        }}
      />
    </main>
  );
}
