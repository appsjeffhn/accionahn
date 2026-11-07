"use server";

import { revalidatePath } from "next/cache";
import { listOwnerCatalog, saveSettings } from "@/lib/catalog/catalog";
import { field } from "@/lib/catalog/form";
import { parseDateRuleForm, parseSettingsForm, parseZoneForm } from "@/lib/store/settings";
import {
  deleteDateRule,
  deleteZone,
  loadTenantCurrencies,
  saveDateRule,
  saveZone,
} from "@/lib/store/setup";
import { failed, saved, type FormState } from "../form-state";
import { failure, panelSession } from "../session";

// Each action takes the tenant from the panel session; ids in the form are only used to
// pick a row of that tenant (other tenants' ids are refused by the store).

export async function saveSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, tenantId } = await panelSession();
  const [currencies, catalog] = await Promise.all([loadTenantCurrencies(session), listOwnerCatalog(session, tenantId)]);
  const theme = (catalog.settings?.theme ?? {}) as Record<string, unknown>;
  const parsed = parseSettingsForm(fd, { tenantId, baseCurrency: currencies.baseCurrency, theme });
  if (!parsed.ok) return failed(parsed.errors);
  try {
    await saveSettings(session, parsed.value);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/settings");
  return saved();
}

export async function saveDateRuleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, tenantId } = await panelSession();
  const { baseCurrency } = await loadTenantCurrencies(session);
  const parsed = parseDateRuleForm(fd, { tenantId, baseCurrency });
  if (!parsed.ok) return failed(parsed.errors);
  try {
    await saveDateRule(session, parsed.value);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/settings");
  return saved();
}

export async function deleteDateRuleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  try {
    await deleteDateRule(session, field(fd, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/settings");
  return saved();
}

export async function saveZoneAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, tenantId } = await panelSession();
  const { baseCurrency } = await loadTenantCurrencies(session);
  const parsed = parseZoneForm(fd, { tenantId, baseCurrency });
  if (!parsed.ok) return failed(parsed.errors);
  try {
    await saveZone(session, parsed.value);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/settings");
  return saved();
}

export async function deleteZoneAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  try {
    await deleteZone(session, field(fd, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/settings");
  return saved();
}
