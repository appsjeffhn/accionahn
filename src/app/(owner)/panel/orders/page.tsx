import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { REVIEW_ALERT_HOURS, parseStatusFilter, toOrderRow } from "@/lib/orders/orders-view";
import { listPanelOrders, PANEL_ORDERS_LIMIT } from "@/lib/orders/panel-orders";
import { ORDER_STATUSES } from "@/lib/orders/states";
import { panelSession } from "../session";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session } = await panelSession();
  const status = parseStatusFilter((await searchParams).status);
  const [{ orders, timeZone }, t, tAll, locale] = await Promise.all([
    listPanelOrders(session, { status }),
    getTranslations("panel.orders"),
    getTranslations(),
    getLocale(),
  ]);
  const lang = locale === "en" ? "en" : "es";
  const now = new Date();
  const rows = orders.map((o) => toOrderRow(o, lang, { now, timeZone }));
  const overdue = rows.filter((r) => r.reviewOverdue).length;

  const filters = [
    { key: "all", href: "/panel/orders", label: t("filterAll"), current: status === null },
    ...ORDER_STATUSES.map((s) => ({
      key: s,
      href: `/panel/orders?status=${s}`,
      label: t(`status.${s}`),
      current: status === s,
    })),
  ];

  return (
    <main>
      <h1>{t("title")}</h1>

      <nav aria-label={t("filterLabel")}>
        <ul className="filters">
          {filters.map((f) => (
            <li key={f.key}>
              <Link href={f.href} aria-current={f.current ? "page" : undefined}>
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {overdue > 0 && (
        <p className="alert" role="status">
          {t("overdueSummary", { count: overdue, hours: REVIEW_ALERT_HOURS })}
        </p>
      )}

      {rows.length === 0 ? (
        <p>{status ? t("emptyFiltered") : t("empty")}</p>
      ) : (
        <ul className="cards">
          {rows.map((row) => (
            <li key={row.id} className="card order-card">
              <div className="row-card">
                <h2 className="order-name">
                  <Link href={`/panel/orders/${row.id}`}>{row.customerName}</Link>
                </h2>
                <span className={`badge status-${row.status}`}>{tAll(row.statusLabelKey)}</span>
              </div>
              <p className="order-meta">
                <span>{row.whenLabel}</span>
                <span>
                  {t("total")}: {row.totalLabel}
                </span>
              </p>
              {row.reviewOverdue && (
                <p className="badge warn">{t("overdue", { hours: REVIEW_ALERT_HOURS })}</p>
              )}
              {row.actions.some((a) => a !== "cancel") && (
                <p className="hint">
                  {t("pendingActions")}: {row.actions.filter((a) => a !== "cancel").map((a) => t(`actions.${a}`)).join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length === PANEL_ORDERS_LIMIT && <p className="hint">{t("limitNote", { limit: PANEL_ORDERS_LIMIT })}</p>}
    </main>
  );
}
