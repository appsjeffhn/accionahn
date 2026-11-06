import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { listCalendarSetup, loadTenantCurrencies } from "@/lib/store/setup";
import { Field, Hidden, PanelForm, Select } from "../../form-kit";
import { panelSession } from "../../session";
import { adjustStockAction, deleteProductAction, saveProductAction } from "../actions";
import { toInitial } from "../initial";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";

const NEW_VARIANT_IDS = 20;

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { session, tenantId } = await panelSession();
  const [{ id }, { saved }] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();

  const [catalog, setup, currencies, t, te] = await Promise.all([
    listOwnerCatalog(session, tenantId),
    listCalendarSetup(session),
    loadTenantCurrencies(session),
    getTranslations("panel.products"),
    getTranslations("panel.editor"),
  ]);
  const product = catalog.products.find((p) => p.id === id);
  if (!product) notFound();
  const variants = catalog.variants.filter((v) => v.product_id === id);
  const initial = toInitial(
    product,
    variants,
    setup.productCalendars.find((c) => c.productId === id),
    currencies.baseCurrency,
  );
  const tracked = initial.variants.filter((v) => v.stock !== null);

  return (
    <main>
      <p>
        <Link href="/panel/products">{t("back")}</Link>
      </p>
      <h1>{initial.name.es || initial.name.en}</h1>
      {saved && (
        <p role="status" className="notice">
          {t("savedNotice")}
        </p>
      )}
      <ProductEditor
        key={saved ?? "initial"}
        action={saveProductAction}
        initial={initial}
        baseCurrency={currencies.baseCurrency}
        extraCurrencies={currencies.enabledCurrencies.filter((c) => c !== currencies.baseCurrency)}
        newVariantIds={Array.from({ length: NEW_VARIANT_IDS }, () => randomUUID())}
      />

      {tracked.length > 0 && (
        <section aria-labelledby="stock-title">
          <h2 id="stock-title">{t("stockTitle")}</h2>
          <p className="hint">{t("stockHint")}</p>
          <ul className="cards">
            {tracked.map((v) => (
              <li key={v.id} className="card">
                <h3>{v.labelEs || v.labelEn}</h3>
                <p>{te("stockCurrent", { stock: v.stock ?? 0 })}</p>
                <PanelForm action={adjustStockAction} submitLabel={t("stockApply")}>
                  <Hidden name="variantId" value={v.id} />
                  <Select
                    name="mode"
                    label={t("stockMode")}
                    defaultValue="set"
                    options={[
                      { value: "set", label: t("stockSet") },
                      { value: "delta", label: t("stockDelta") },
                    ]}
                  />
                  <Field name="value" label={t("stockValue")} hint={t("stockValueHint")} type="number" step="1" required />
                </PanelForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="delete-title">
        <h2 id="delete-title">{t("deleteTitle")}</h2>
        <p className="hint">{t("deleteHint")}</p>
        <PanelForm action={deleteProductAction} submitLabel={t("delete")} confirmText={t("deleteConfirm")} danger>
          <Hidden name="id" value={initial.id} />
        </PanelForm>
      </section>
    </main>
  );
}
