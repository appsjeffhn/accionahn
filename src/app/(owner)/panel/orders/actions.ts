"use server";

import { revalidatePath } from "next/cache";
import { field } from "@/lib/catalog/form";
import {
  approveProof,
  cancelOrder,
  HoldsReleasedError,
  InvalidOperationError,
  InvalidOrderStateError,
  OrderNotFoundError,
  rejectProof,
  setQuotedPrice,
  setShippingFee,
} from "@/lib/orders/operations";
import { parseAmountForm, parseReasonForm } from "@/lib/orders/orders-view";
import { loadTenantCurrencies } from "@/lib/store/setup";
import { failed, saved, type FormState } from "../form-state";
import { failure, panelSession } from "../session";

// Each action takes the session from panelSession itself. The order id in the form is
// only a pointer: the operations look the order up and refuse it (ForbiddenError) unless
// it belongs to the session tenant; amounts are typed in the tenant base currency.

function opFailure(error: unknown): FormState {
  if (error instanceof HoldsReleasedError) return failed({ _form: "holdsReleased" });
  if (error instanceof OrderNotFoundError) return failed({ _form: "orderNotFound" });
  if (error instanceof InvalidOrderStateError) {
    if (error.code === "no_proof") return failed({ _form: "noProof" });
    if (error.code === "multiple_unpriced_lines") return failed({ _form: "multipleUnpriced" });
    if (error.code === "missing_rate") return failed({ _form: "missingRate" });
    return failed({ _form: "orderState" });
  }
  if (error instanceof InvalidOperationError) {
    if (error.code === "reason_required") return failed({ reason: "reasonRequired" });
    if (error.code === "invalid_amount") return failed({ amount: "money" });
  }
  return failure(error);
}

function done(orderId: string): FormState {
  revalidatePath("/panel/orders");
  revalidatePath(`/panel/orders/${orderId}`);
  return saved();
}

async function priceAction(fd: FormData, op: typeof setShippingFee): Promise<FormState> {
  const { session } = await panelSession();
  const { baseCurrency } = await loadTenantCurrencies(session);
  const parsed = parseAmountForm(fd, baseCurrency);
  if (!parsed.ok) return failed(parsed.errors);
  const orderId = field(fd, "id");
  try {
    await op(session, orderId, parsed.value);
  } catch (error) {
    return opFailure(error);
  }
  return done(orderId);
}

export async function setShippingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return priceAction(fd, setShippingFee);
}

export async function setPriceAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return priceAction(fd, setQuotedPrice);
}

export async function approveAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { session } = await panelSession();
  const orderId = field(fd, "id");
  try {
    await approveProof(session, orderId);
  } catch (error) {
    return opFailure(error);
  }
  return done(orderId);
}

async function reasonAction(fd: FormData, op: typeof rejectProof): Promise<FormState> {
  const { session } = await panelSession();
  const parsed = parseReasonForm(fd);
  if (!parsed.ok) return failed(parsed.errors);
  const orderId = field(fd, "id");
  try {
    await op(session, orderId, parsed.value);
  } catch (error) {
    return opFailure(error);
  }
  return done(orderId);
}

export async function rejectAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return reasonAction(fd, rejectProof);
}

export async function cancelAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return reasonAction(fd, cancelOrder);
}
