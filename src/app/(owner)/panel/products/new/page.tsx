import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { loadTenantCurrencies } from "@/lib/store/setup";
import { panelSession } from "../../session";
import { saveProductAction } from "../actions";
import { emptyInitial } from "../initial";
import { ProductEditor } from "../product-editor";

export const dynamic = "force-dynamic";

const NEW_VARIANT_IDS = 20;

export default async function NewProductPage() {
  const { session } = await panelSession();
  const [currencies, t] = await Promise.all([loadTenantCurrencies(session), getTranslations("panel.products")]);

  return (
    <main>
      <p>
        <Link href="/panel/products">{t("back")}</Link>
      </p>
      <h1>{t("newTitle")}</h1>
      {/* Ids are chosen once per page load: a retried save updates the same product. */}
      <ProductEditor
        action={saveProductAction}
        initial={emptyInitial(randomUUID())}
        baseCurrency={currencies.baseCurrency}
        extraCurrencies={currencies.enabledCurrencies.filter((c) => c !== currencies.baseCurrency)}
        newVariantIds={Array.from({ length: NEW_VARIANT_IDS }, () => randomUUID())}
      />
    </main>
  );
}
