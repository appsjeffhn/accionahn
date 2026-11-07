import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AlreadyMemberError,
  ExistingAccountError,
  InvalidEmailError,
  TenantNotActiveError,
  callbackUrlFor,
  inviteOwner,
} from "@/lib/auth/owner-invite";
import { ForbiddenError, getSession, getUserClient, requireRole } from "@/lib/auth/session";
import { parseEnv } from "@/lib/env";
import {
  EXTRA_CURRENCY_ROWS,
  submittedValues,
  validateWizardForm,
  type WizardState,
} from "@/lib/agency/wizard-form";
import {
  ORDER_FIELD_KEYS,
  SUPPORTED_CURRENCIES,
} from "@/lib/agency/wizard-schema";
import {
  completeWizard,
  SlugTakenError,
  WizardStateError,
} from "@/lib/agency/wizard";
import { WizardForm } from "./wizard-form";
import { InviteOwnerForm, type InviteState } from "./invite-owner-form";

const INVITE_ERROR_KEYS = [
  "invalidEmail",
  "alreadyMember",
  "existingAccount",
  "tenantNotActive",
  "failed",
] as const;

function inviteError(error: unknown): InviteState["error"] {
  if (error instanceof InvalidEmailError) return "invalidEmail";
  if (error instanceof AlreadyMemberError) return "alreadyMember";
  if (error instanceof ExistingAccountError) return "existingAccount";
  if (error instanceof TenantNotActiveError) return "tenantNotActive";
  return "failed";
}

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

export default async function WizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  requireRole(await getSession(), "agency_admin");
  const { id } = await params;
  const t = await getTranslations("wizard");
  // As the signed-in admin under RLS; the service key stays confined to auth.admin.*.
  const { data: tenant, error: tenantError } = await (await getUserClient())
    .from("tenants")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  // 22P02: the id in the URL is not a uuid.
  if (tenantError && tenantError.code !== "22P02") throw tenantError;
  if (!tenant) notFound();

  async function invite(_prev: InviteState, formData: FormData): Promise<InviteState> {
    "use server";
    const session = await getSession();
    const requestHeaders = await headers();
    const email = formData.get("email");
    let result: Awaited<ReturnType<typeof inviteOwner>>;
    try {
      result = await inviteOwner(session, id, typeof email === "string" ? email : "", {
        callbackUrl: callbackUrlFor({
          appEnv: parseEnv(process.env).APP_ENV,
          host: requestHeaders.get("host"),
          proto: requestHeaders.get("x-forwarded-proto"),
        }),
      });
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      const key = inviteError(error);
      if (key === "failed") {
        // Name and code only: Auth errors may echo request details.
        const e = error as { name?: string; code?: string; status?: number };
        console.error("invite owner failed", e?.name, e?.code ?? e?.status);
      }
      return { status: "error", error: key };
    }
    return { status: result === "resent" ? "resent" : "sent" };
  }

  const inviteForm = (
    <InviteOwnerForm
      action={invite}
      labels={{
        title: t("invite.title"),
        help: t("invite.help"),
        email: t("invite.email"),
        submit: t("invite.submit"),
        sent: t("invite.sent"),
        resent: t("invite.resent"),
        errors: Object.fromEntries(
          INVITE_ERROR_KEYS.map((k) => [k, t(`invite.errors.${k}`)]),
        ),
      }}
    />
  );

  // Once the store is active the wizard is done; what is left is inviting its owner.
  if (tenant.status !== "pending") {
    return <main>{inviteForm}</main>;
  }

  async function submit(_prev: WizardState, formData: FormData): Promise<WizardState> {
    "use server";
    requireRole(await getSession(), "agency_admin");
    const result = validateWizardForm(formData);
    if (!result.ok) return result.state;
    try {
      await completeWizard(id, result.data);
    } catch (error) {
      if (error instanceof SlugTakenError) return { errors: { slug: "slugTaken" }, values: submittedValues(formData) };
      if (error instanceof WizardStateError) return { errors: { _form: "notPending" }, values: submittedValues(formData) };
      throw error;
    }
    // Back to this page: the store is now active and shows the owner invitation.
    redirect(`/agency/tenants/${id}/wizard`);
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
