"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listOwnerCatalog, saveProduct } from "@/lib/catalog/catalog";
import { field, intField, parseProductForm } from "@/lib/catalog/form";
import { parseProductCalendarForm } from "@/lib/store/calendar-form";
import {
  deleteProduct,
  loadTenantCurrencies,
  saveProductCalendar,
  setVariantStock,
} from "@/lib/store/setup";
import { failed, saved, type FormState } from "../form-state";
import { failure, panelSession } from "../session";

// Product, variants and (for reservable products) the booking limits. The tenant comes
// from the session; the product and variant ids from the form are checked against it by
// save_product (42501 -> ForbiddenError).
export async function saveProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session, tenantId } = await panelSession();
  const productId = field(fd, "id");
  const [currencies, catalog] = await Promise.all([
    loadTenantCurrencies(session),
    listOwnerCatalog(session, tenantId),
  ]);
  const existing = catalog.products.find((p) => p.id === productId);

  const product = parseProductForm(fd, {
    tenantId,
    baseCurrency: currencies.baseCurrency,
    extraCurrencies: currencies.enabledCurrencies.filter((c) => c !== currencies.baseCurrency),
    images: Array.isArray(existing?.images) ? (existing.images as string[]) : [],
  });
  const calendar = fd.get("reservable") === "on" ? parseProductCalendarForm(fd, productId) : null;
  const errors = {
    ...(calendar && !calendar.ok ? calendar.errors : {}),
    ...(!product.ok ? product.errors : {}),
  };
  if (!product.ok || (calendar && !calendar.ok)) return failed(errors);

  try {
    await saveProduct(session, product.value);
    if (calendar?.ok) await saveProductCalendar(session, calendar.value);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/products");
  revalidatePath("/panel/products/[id]", "page");
  // A fresh page (the editor is keyed by `saved`): new variants now show as existing ones.
  redirect(`/panel/products/${productId}?saved=${Date.now()}`);
}

// Deleting a product that orders or bookings reference fails (InUseError): the owner is
// told to deactivate it instead.
export async function deleteProductAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  try {
    await deleteProduct(session, field(fd, "id"));
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/products");
  redirect("/panel/products");
}

// Fields: variantId, mode (set | delta), value. "set" becomes a delta from the stock read
// at save time, so units held by orders are never overwritten.
export async function adjustStockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  const mode = field(fd, "mode") === "delta" ? "delta" : "set";
  const value = intField(fd, "value");
  if (Number.isNaN(value) || (mode === "set" && value < 0)) return failed({ value: "stockValue" });
  try {
    await setVariantStock(session, field(fd, "variantId"), { mode, value });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/panel/products/[id]", "page");
  return saved();
}
