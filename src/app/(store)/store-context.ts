import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import {
  CART_COOKIE,
  CART_MAX_AGE_SECONDS,
  EMPTY_CART,
  parseCart,
  serializeCart,
  type Cart,
} from "@/lib/cart/cart";
import { listPublicCatalog, type PublicCatalog } from "@/lib/catalog/catalog";
import { parseEnv } from "@/lib/env";
import { readStoreSettings } from "@/lib/orders/orders";
import { TENANT_ID_HEADER } from "@/lib/routing/decide-request";
import { loadStorefront, type Storefront } from "@/lib/store/storefront";

export type StoreLocale = "es" | "en";

export type StoreContext = Storefront & {
  tenantId: string;
  locale: StoreLocale;
  catalog: PublicCatalog;
  settings: ReturnType<typeof readStoreSettings>;
  // Origin of the project's Supabase Storage, for public URLs of tenant-assets.
  storageUrl: string;
};

// Tenant id from the middleware's header only. On the agency host (no tenant) and for a
// tenant that is not active, every store page is a 404. Cached per request.
export const storeTenantId = cache(async (): Promise<string | null> => {
  const id = (await headers()).get(TENANT_ID_HEADER);
  return id && id !== "" ? id : null;
});

export const storeContext = cache(async (): Promise<StoreContext> => {
  const tenantId = await storeTenantId();
  if (!tenantId) notFound();
  const [front, catalog, locale] = await Promise.all([
    loadStorefront(tenantId),
    listPublicCatalog(tenantId),
    getLocale(),
  ]);
  if (!front) notFound();
  return {
    ...front,
    tenantId,
    locale: locale === "en" ? "en" : "es",
    catalog,
    settings: readStoreSettings(catalog.settings),
    storageUrl: parseEnv(process.env).SUPABASE_URL,
  };
});

export async function readCart(): Promise<Cart> {
  return parseCart((await cookies()).get(CART_COOKIE)?.value);
}

// Throws CartFullError when the cart does not fit the cookie. An empty cart clears it.
export async function writeCart(cart: Cart): Promise<void> {
  const jar = await cookies();
  if (cart.lines.length === 0) {
    jar.delete(CART_COOKIE);
    return;
  }
  jar.set(CART_COOKIE, serializeCart(cart), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_MAX_AGE_SECONDS,
  });
}

export async function clearCart(): Promise<void> {
  await writeCart(EMPTY_CART);
}
