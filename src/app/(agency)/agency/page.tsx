import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSession, requireRole } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  slug: string;
  status: "pending" | "active" | "suspended";
  cohort: "pilot" | "general";
};

export default async function AgencyHomePage() {
  requireRole(await getSession(), "agency_admin");
  const t = await getTranslations("agency");
  const { data, error } = await createServiceClient()
    .from("tenants")
    .select("id, name, slug, status, cohort")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  return (
    <main>
      <h1>{t("title")}</h1>
      <nav>
        <ul>
          <li>
            <Link href="/agency/requests">{t("nav.requests")}</Link>
          </li>
          <li>
            <Link href="/agency/releases">{t("nav.releases")}</Link>
          </li>
        </ul>
      </nav>
      <h2>{t("tenants")}</h2>
      {rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("name")}</th>
              <th>{t("slug")}</th>
              <th>{t("statusLabel")}</th>
              <th>{t("cohortLabel")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.slug}</td>
                <td>{t(`status.${r.status}`)}</td>
                <td>{t(`cohort.${r.cohort}`)}</td>
                <td>
                  {r.status === "pending" && (
                    <Link href={`/agency/tenants/${r.id}/wizard`}>
                      {t("configure")}
                    </Link>
                  )}
                  {r.status === "active" && (
                    <Link href={`/agency/tenants/${r.id}/wizard`}>
                      {t("inviteOwner")}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
