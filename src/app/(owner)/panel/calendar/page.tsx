import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { listCalendarSetup } from "@/lib/store/setup";
import { Check, Field, Hidden, PanelForm, Select } from "../form-kit";
import { panelSession } from "../session";
import {
  deleteClosedDateAction,
  deleteHoursAction,
  deleteResourceAction,
  saveClosedDateAction,
  saveHoursAction,
  saveResourceAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Translate = Awaited<ReturnType<typeof getTranslations>>;
type Product = { id: string; name: string };

const WEEK = [1, 2, 3, 4, 5, 6, 0];

function ResourceFields({
  t,
  products,
  resource,
}: {
  t: Translate;
  products: Product[];
  resource?: { name: string; active: boolean; services: string[] };
}) {
  return (
    <>
      <Field name="name" label={t("resourceName")} defaultValue={resource?.name} required />
      <Check name="active" label={t("resourceActive")} hint={t("resourceActiveHint")} defaultChecked={resource ? resource.active : true} />
      {products.length > 0 && (
        <fieldset>
          <legend>{t("services")}</legend>
          <p className="hint">{t("servicesHint")}</p>
          {products.map((p) => (
            <Check key={p.id} name="services" value={p.id} label={p.name} defaultChecked={resource?.services.includes(p.id)} />
          ))}
        </fieldset>
      )}
    </>
  );
}

export default async function CalendarPage() {
  const { session, tenantId } = await panelSession();
  const [catalog, setup, t, tw, locale] = await Promise.all([
    listOwnerCatalog(session, tenantId),
    listCalendarSetup(session),
    getTranslations("panel.calendar"),
    getTranslations("panel.weekdays"),
    getLocale(),
  ]);
  const lang = locale === "en" ? "en" : "es";
  const nameOf = (v: unknown) => {
    const o = (v ?? {}) as Record<string, string>;
    return o[lang] || o.es || o.en || "";
  };
  const reservable: Product[] = catalog.products
    .filter((p) => p.reservable === true)
    .map((p) => ({ id: String(p.id), name: nameOf(p.name) }));
  const resourceName = (id: string | null) =>
    id === null ? t("wholeStore") : (setup.resources.find((r) => r.id === id)?.name ?? "?");
  const resourceOptions = [
    { value: "", label: t("wholeStore") },
    ...setup.resources.map((r) => ({ value: r.id, label: r.name })),
  ];
  const ids = { resource: randomUUID(), hours: randomUUID(), closed: randomUUID() };

  return (
    <main>
      <h1>{t("title")}</h1>
      <p className="hint">{t("intro")}</p>

      <section aria-labelledby="products-title">
        <h2 id="products-title">{t("productsTitle")}</h2>
        {reservable.length === 0 ? (
          <p>{t("productsEmpty")}</p>
        ) : (
          <ul>
            {reservable.map((p) => {
              const cal = setup.productCalendars.find((c) => c.productId === p.id);
              return (
                <li key={p.id}>
                  <Link href={`/panel/products/${p.id}`}>{p.name}</Link>
                  {" · "}
                  {cal
                    ? t("productLimits", { service: cal.serviceMinutes, step: cal.slotStepMinutes })
                    : <strong>{t("productNoLimits")}</strong>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="resources-title">
        <h2 id="resources-title">{t("resourcesTitle")}</h2>
        <p className="hint">{t("resourcesHint")}</p>
        <ul className="cards">
          {setup.resources.map((r) => (
            <li key={r.id} className="card">
              <details>
                <summary>
                  {r.name}
                  {!r.active && ` · ${t("inactive")}`}
                </summary>
                <PanelForm action={saveResourceAction} submitLabel={t("save")}>
                  <Hidden name="id" value={r.id} />
                  <ResourceFields t={t} products={reservable} resource={r} />
                </PanelForm>
                <PanelForm action={deleteResourceAction} submitLabel={t("delete")} confirmText={t("deleteConfirm")} danger>
                  <Hidden name="id" value={r.id} />
                </PanelForm>
              </details>
            </li>
          ))}
        </ul>
        <details className="card">
          <summary>{t("addResource")}</summary>
          <PanelForm key={ids.resource} action={saveResourceAction} submitLabel={t("add")}>
            <Hidden name="id" value={ids.resource} />
            <ResourceFields t={t} products={reservable} />
          </PanelForm>
        </details>
      </section>

      <section aria-labelledby="hours-title">
        <h2 id="hours-title">{t("hoursTitle")}</h2>
        <p className="hint">{t("hoursHint")}</p>
        {setup.hours.length === 0 ? (
          <p>
            <strong>{t("hoursEmpty")}</strong>
          </p>
        ) : (
          <ul className="cards">
            {[...setup.hours]
              .sort((a, b) => WEEK.indexOf(a.weekday) - WEEK.indexOf(b.weekday) || a.opens.localeCompare(b.opens))
              .map((h) => (
                <li key={h.id} className="card row-card">
                  <span>
                    {tw(String(h.weekday))} {h.opens}–{h.closes} · {resourceName(h.resourceId)}
                  </span>
                  <PanelForm
                    action={deleteHoursAction}
                    submitLabel={t("delete")}
                    submitAriaLabel={t("deleteHours", { day: tw(String(h.weekday)), opens: h.opens, closes: h.closes })}
                    className="inline-form"
                    danger
                  >
                    <Hidden name="id" value={h.id} />
                  </PanelForm>
                </li>
              ))}
          </ul>
        )}
        <details className="card">
          <summary>{t("addHours")}</summary>
          <PanelForm key={ids.hours} action={saveHoursAction} submitLabel={t("add")}>
            <Hidden name="id" value={ids.hours} />
            <Select name="resourceId" label={t("resource")} options={resourceOptions} defaultValue="" />
            <Select
              name="weekday"
              label={t("weekday")}
              defaultValue="1"
              options={WEEK.map((d) => ({ value: String(d), label: tw(String(d)) }))}
            />
            <Field name="opens" label={t("opens")} type="time" defaultValue="08:00" required />
            <Field name="closes" label={t("closes")} type="time" defaultValue="17:00" required />
          </PanelForm>
        </details>
      </section>

      <section aria-labelledby="closed-title">
        <h2 id="closed-title">{t("closedTitle")}</h2>
        <p className="hint">{t("closedHint")}</p>
        {setup.closed.length === 0 ? (
          <p>{t("closedEmpty")}</p>
        ) : (
          <ul className="cards">
            {setup.closed.map((c) => (
              <li key={c.id} className="card row-card">
                <span>
                  {c.day} · {resourceName(c.resourceId)}
                  {c.reason && ` · ${c.reason}`}
                </span>
                <PanelForm
                  action={deleteClosedDateAction}
                  submitLabel={t("delete")}
                  submitAriaLabel={t("deleteClosed", { day: c.day })}
                  className="inline-form"
                  danger
                >
                  <Hidden name="id" value={c.id} />
                </PanelForm>
              </li>
            ))}
          </ul>
        )}
        <details className="card">
          <summary>{t("addClosed")}</summary>
          <PanelForm key={ids.closed} action={saveClosedDateAction} submitLabel={t("add")}>
            <Hidden name="id" value={ids.closed} />
            <Select name="resourceId" label={t("resource")} options={resourceOptions} defaultValue="" />
            <Field name="day" label={t("day")} type="date" required />
            <Field name="reason" label={t("reason")} />
          </PanelForm>
        </details>
      </section>
    </main>
  );
}
