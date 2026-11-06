"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addToCart, CartFullError, cartIssues, removeFromCart } from "@/lib/cart/cart";
import { listAvailableSlots, localDay } from "@/lib/calendar/calendar";
import { submitProof, PROOF_MAX_BYTES } from "@/lib/orders/operations";
import { createOrder } from "@/lib/orders/orders";
import {
  buildCartItem,
  checkoutErrorKey,
  lineErrorKey,
  parseAddToCartForm,
  parseCheckoutForm,
  proofErrorKey,
} from "@/lib/store/checkout";
import { clientKey, createRateLimiter } from "@/lib/store/throttle";
import { clearCart, readCart, storeContext, storeTenantId, writeCart } from "./store-context";
import { failed, saved, type StoreFormState } from "./form-state";

// Storefront server actions. The tenant always comes from the middleware's header (via
// storeContext), never from a form; every form goes through the parsers of
// lib/store/checkout.ts before touching the catalog, the engine or createOrder; amounts
// are never read from the client.

// Per-client throttles (hashed address, in memory, per server instance). Checkout: a
// burst of 5 attempts, then one more every 12 minutes. Proofs: 10, then one per 6 min.
const checkoutLimiter = createRateLimiter({ capacity: 5, refillMs: 12 * 60_000 });
const proofLimiter = createRateLimiter({ capacity: 10, refillMs: 6 * 60_000 });

const LINE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function newLineId(): string {
  return randomBytes(9).toString("base64url");
}

export async function addToCartAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const ctx = await storeContext();
  const parsed = parseAddToCartForm(fd);
  if (!parsed.ok) return failed({ _form: "invalid" });
  const built = buildCartItem(parsed.value, ctx.catalog, newLineId());
  if (!built.ok) return failed({ _form: lineErrorKey(built.code) });

  // A per-line slot must be one the calendar offers now (createOrder checks it again).
  const start = built.item.start;
  if (start) {
    const day = localDay(Date.parse(start), ctx.settings.timezone);
    const slots = await listAvailableSlots(ctx.tenantId, built.item.productId, day);
    if (!slots.some((s) => Date.parse(s.start) === Date.parse(start))) return failed({ start: "slotTaken" });
  }

  try {
    await writeCart(addToCart(await readCart(), built.item));
  } catch (error) {
    if (error instanceof CartFullError) return failed({ _form: "cartFull" });
    throw error;
  }
  redirect("/cart");
}

export async function removeFromCartAction(fd: FormData): Promise<void> {
  await storeContext();
  const lineId = fd.get("lineId");
  if (typeof lineId !== "string" || !LINE_ID_RE.test(lineId)) return;
  await writeCart(removeFromCart(await readCart(), lineId));
  revalidatePath("/cart");
}

export async function checkoutAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const ctx = await storeContext();
  const cart = await readCart();
  if (cart.lines.length === 0) return failed({ _form: "emptyCart" });
  if (cartIssues(cart, ctx.catalog).length > 0) return failed({ _form: "cartChanged" });

  const reservable = new Set(ctx.catalog.products.filter((p) => p.reservable === true).map((p) => p.id as string));
  const needsOrderSlot = !ctx.settings.perLineDate && cart.lines.some((l) => reservable.has(l.productId));
  const form = parseCheckoutForm(fd, {
    orderFields: ctx.orderFields,
    shippingMode: ctx.settings.mode,
    needsOrderSlot,
  });
  if (!form.ok) return failed(form.errors);

  // Counted only for well-formed attempts, so typos do not lock a customer out.
  if (!checkoutLimiter.take(clientKey(await headers()))) return failed({ _form: "throttled" });

  let publicToken: string;
  try {
    const created = await createOrder(ctx.tenant, {
      lines: cart.lines.map((l) => ({
        lineId: l.lineId,
        productId: l.productId,
        variantId: l.variantId,
        qty: l.qty,
        people: l.people,
        meats: l.meats,
        toppings: l.toppings,
        start: ctx.settings.perLineDate ? l.start : undefined,
      })),
      customer: form.value.customer,
      fields: form.value.fields,
      zoneId: form.value.zoneId,
      start: form.value.start,
    });
    publicToken = created.publicToken;
  } catch (error) {
    const key = checkoutErrorKey(error);
    if (key === "failed") {
      const e = error as { name?: string; code?: string };
      console.error("store checkout failed", e?.name, e?.code);
    }
    return failed({ _form: key });
  }
  await clearCart();
  redirect(`/order/${publicToken}`);
}

export async function uploadProofAction(_prev: StoreFormState, fd: FormData): Promise<StoreFormState> {
  const tenantId = await storeTenantId();
  const token = fd.get("token");
  if (!tenantId || typeof token !== "string" || !TOKEN_RE.test(token)) return failed({ _form: "unavailable" });

  // The request body is capped by serverActions.bodySizeLimit (next.config.ts) before it
  // is parsed; the declared size is checked here before the bytes are read.
  const file = fd.get("proof");
  if (!(file instanceof File) || file.size === 0) return failed({ proof: "noFile" });
  if (file.size > PROOF_MAX_BYTES) return failed({ proof: "tooLarge" });
  if (!proofLimiter.take(clientKey(await headers()))) return failed({ _form: "throttled" });

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await submitProof(token, { bytes, contentType: file.type }, { tenantId });
  } catch (error) {
    const key = proofErrorKey(error);
    if (key === "failed") {
      const e = error as { name?: string; code?: string };
      console.error("store proof upload failed", e?.name, e?.code);
    }
    return failed(key === "tooLarge" || key === "fileType" ? { proof: key } : { _form: key });
  }
  revalidatePath(`/order/${token}`);
  return saved();
}
