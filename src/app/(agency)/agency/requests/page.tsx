import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSession, requireRole } from "@/lib/auth/session";
import {
  approveRequest,
  isStaleClaim,
  rejectRequest,
} from "@/lib/agency/requests";
import { createSupabaseTenant } from "@/lib/agency/requests.store";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

async function approve(formData: FormData) {
  "use server";
  requireRole(await getSession(), "agency_admin");
  const id = String(formData.get("id") ?? "");
  await approveRequest(id, { createTenant: createSupabaseTenant() });
  revalidatePath("/agency/requests");
}

async function reject(formData: FormData) {
  "use server";
  requireRole(await getSession(), "agency_admin");
  await rejectRequest(String(formData.get("id") ?? ""));
  revalidatePath("/agency/requests");
}

type Row = {
  id: string;
  business_name: string;
  contact_email: string;
  country: string;
  status: "pending" | "approved" | "rejected";
  tenant_id: string | null;
  approved_at: string | null;
  created_at: string;
};

export default async function RequestsPage() {
  requireRole(await getSession(), "agency_admin");
  const t = await getTranslations("agency.requests");
  const { data, error } = await createServiceClient()
    .from("client_requests")
    .select(
      "id, business_name, contact_email, country, status, tenant_id, approved_at, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  return (
    <main>
      <h1>{t("title")}</h1>
      {rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t("business")}</th>
              <th>{t("email")}</th>
              <th>{t("country")}</th>
              <th>{t("statusLabel")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const stuck = isStaleClaim({
                id: r.id,
                businessName: r.business_name,
                status: r.status,
                tenantId: r.tenant_id,
                approvedAt: r.approved_at ? new Date(r.approved_at) : null,
              });
              const approving =
                r.status === "approved" && r.tenant_id === null && !stuck;
              return (
                <tr key={r.id}>
                  <td>{r.business_name}</td>
                  <td>{r.contact_email}</td>
                  <td>{r.country}</td>
                  <td>
                    {stuck
                      ? t("status.approvedNoTenant")
                      : approving
                        ? t("status.approving")
                        : t(`status.${r.status}`)}
                  </td>
                  <td>
                    {(r.status === "pending" || stuck) && (
                      <>
                        <form action={approve}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit">
                            {stuck ? t("retryApprove") : t("approve")}
                          </button>
                        </form>
                        <form action={reject}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit">{t("reject")}</button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
