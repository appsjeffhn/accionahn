import { getLocale, getTranslations } from "next-intl/server";
import { listOwnerCatalog } from "@/lib/catalog/catalog";
import { parseEnv } from "@/lib/env";
import { resolveImageSource } from "@/lib/store/assets";
import { DEFAULT_THEME, HEADING_MAX, readStoredTheme, TAGLINE_MAX, THEME_FONTS } from "@/lib/store/theme";
import { Check, Field, PanelForm, Select } from "../form-kit";
import { panelSession } from "../session";
import { saveAppearanceAction } from "./actions";
import { AppearancePreview } from "./appearance-preview";

export const dynamic = "force-dynamic";

const COLORS = ["background", "text", "primary", "accent"] as const;

export default async function AppearancePage() {
  const { session, tenantId } = await panelSession();
  const [catalog, t, locale] = await Promise.all([
    listOwnerCatalog(session, tenantId),
    getTranslations("panel.appearance"),
    getLocale(),
  ]);
  const lang = locale === "en" ? "en" : "es";
  const stored = readStoredTheme(catalog.settings?.theme, tenantId);
  const theme = stored ?? DEFAULT_THEME;
  const logo = stored?.logoPath ? resolveImageSource(tenantId, stored.logoPath, parseEnv(process.env).SUPABASE_URL) : null;
  const other = lang === "es" ? "en" : "es";

  return (
    <main>
      <h1>{t("title")}</h1>
      <p className="hint">{t("intro")}</p>
      <PanelForm action={saveAppearanceAction} submitLabel={t("save")}>
        <fieldset>
          <legend>{t("colors")}</legend>
          <p className="hint">{t("colorsHint")}</p>
          <div className="color-fields">
            {COLORS.map((name) => (
              <Field key={name} name={name} type="color" label={t(`color.${name}`)} hint={t(`colorHint.${name}`)} defaultValue={theme[name]} />
            ))}
          </div>
          <Select
            name="font"
            label={t("font")}
            defaultValue={theme.font}
            options={THEME_FONTS.map((f) => ({ value: f, label: t(`fonts.${f}`) }))}
          />
        </fieldset>

        <fieldset>
          <legend>{t("texts")}</legend>
          <Field name="heading.es" label={t("headingEs")} hint={t("textHint", { max: HEADING_MAX })} defaultValue={theme.heading.es ?? ""} />
          <Field name="heading.en" label={t("headingEn")} defaultValue={theme.heading.en ?? ""} />
          <Field name="tagline.es" label={t("taglineEs")} hint={t("textHint", { max: TAGLINE_MAX })} defaultValue={theme.tagline.es ?? ""} />
          <Field name="tagline.en" label={t("taglineEn")} defaultValue={theme.tagline.en ?? ""} />
        </fieldset>

        <fieldset>
          <legend>{t("logo")}</legend>
          {logo ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- public Storage URL of the tenant's own logo */}
              <img src={logo} alt={t("currentLogo")} className="logo-current" />
              <Check name="removeLogo" label={t("removeLogo")} />
            </>
          ) : (
            <p className="hint">{t("noLogo")}</p>
          )}
          <Field name="logo" type="file" accept="image/png,image/jpeg,image/webp" label={t("logoFile")} hint={t("logoHint")} />
        </fieldset>

        <AppearancePreview
          locale={lang}
          storeName={t("previewStoreName")}
          initial={{
            primary: theme.primary,
            accent: theme.accent,
            background: theme.background,
            text: theme.text,
            font: theme.font,
            heading: theme.heading[lang] ?? theme.heading[other] ?? "",
            tagline: theme.tagline[lang] ?? theme.tagline[other] ?? "",
          }}
        />
      </PanelForm>
    </main>
  );
}
