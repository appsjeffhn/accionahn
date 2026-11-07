import { getTranslations } from "next-intl/server";
import { getSession, requireRole } from "@/lib/auth/session";
import { ROLLOUTS, resolveFlagStore } from "@/lib/flags/flags";
import { setRolloutAction } from "@/lib/flags/actions";

export const dynamic = "force-dynamic";

export default async function ReleasesPage() {
  requireRole(await getSession(), "agency_admin");
  const t = await getTranslations("agency.releases");
  const flags = await (await resolveFlagStore()).list();

  return (
    <main>
      <h1>{t("title")}</h1>
      {flags.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("key")}</th>
              <th>{t("rollout")}</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key}>
                <td>{f.key}</td>
                <td>
                  <form action={setRolloutAction}>
                    <input type="hidden" name="key" value={f.key} />
                    <select
                      name="rollout"
                      defaultValue={f.rollout}
                      aria-label={`${t("rollout")}: ${f.key}`}
                    >
                      {ROLLOUTS.map((r) => (
                        <option key={r} value={r}>
                          {t(`options.${r}`)}
                        </option>
                      ))}
                    </select>
                    <button type="submit">{t("apply")}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form action={setRolloutAction}>
        <input
          name="key"
          required
          maxLength={64}
          pattern="[a-z0-9_.\-]{1,64}"
          placeholder={t("newKey")}
          aria-label={t("newKey")}
        />
        <select name="rollout" defaultValue="off" aria-label={t("rollout")}>
          {ROLLOUTS.map((r) => (
            <option key={r} value={r}>
              {t(`options.${r}`)}
            </option>
          ))}
        </select>
        <button type="submit">{t("create")}</button>
      </form>
    </main>
  );
}
