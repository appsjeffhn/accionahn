import { getTranslations } from "next-intl/server";

// Placeholder: Tasks 8 and 9 add products, stock and orders here.
export default async function PanelHomePage() {
  const t = await getTranslations("panel");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("welcome")}</p>
    </main>
  );
}
