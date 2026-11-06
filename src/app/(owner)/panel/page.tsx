import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { panelSession } from "./session";

export default async function PanelHomePage() {
  await panelSession();
  const t = await getTranslations("panel");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("welcome")}</p>
      <ul className="cards">
        {(["orders", "products", "calendar", "settings"] as const).map((key) => (
          <li key={key} className="card">
            <h2>
              <Link href={`/panel/${key}`}>{t(`nav.${key}`)}</Link>
            </h2>
            <p>{t(`home.${key}`)}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
