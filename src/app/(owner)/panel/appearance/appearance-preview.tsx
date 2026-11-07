"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import {
  buttonLabelColor,
  contrastRatio,
  CONTRAST_TEXT,
  CONTRAST_UI,
  FONT_STACKS,
  isHexColor,
  THEME_FONTS,
  type ThemeFont,
} from "@/lib/store/theme";

type Draft = { primary: string; accent: string; background: string; text: string; font: string; heading: string; tagline: string };

function readDraft(form: HTMLFormElement, locale: "es" | "en"): Draft {
  const fd = new FormData(form);
  const get = (name: string) => {
    const v = fd.get(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const other = locale === "es" ? "en" : "es";
  return {
    primary: get("primary"),
    accent: get("accent"),
    background: get("background"),
    text: get("text"),
    font: get("font"),
    heading: get(`heading.${locale}`) || get(`heading.${other}`),
    tagline: get(`tagline.${locale}`) || get(`tagline.${other}`),
  };
}

// Live preview of the form's current values, with the contrast checks the server applies
// on save. Reads the enclosing form on every input; only #rrggbb values and the fixed font
// stacks are put into styles, and texts are rendered as escaped text.
export function AppearancePreview({ initial, locale, storeName }: { initial: Draft; locale: "es" | "en"; storeName: string }) {
  const t = useTranslations("panel.appearance");
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(initial);

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => setDraft(readDraft(form, locale));
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, [locale]);

  const colorsValid = [draft.primary, draft.accent, draft.background, draft.text].every(isHexColor);
  const font = (THEME_FONTS as readonly string[]).includes(draft.font) ? FONT_STACKS[draft.font as ThemeFont] : FONT_STACKS.sans;
  const style = colorsValid
    ? ({
        "--pv-bg": draft.background,
        "--pv-fg": draft.text,
        "--pv-primary": draft.primary,
        "--pv-primary-fg": buttonLabelColor(draft.primary),
        "--pv-accent": draft.accent,
        // the store uses the accent for link text only when it reaches 4.5:1
        "--pv-link": contrastRatio(draft.accent, draft.background) >= CONTRAST_TEXT ? draft.accent : draft.text,
        "--pv-font": font,
      } as CSSProperties)
    : undefined;

  const checks = colorsValid
    ? [
        { key: "checkText", ratio: contrastRatio(draft.text, draft.background), min: CONTRAST_TEXT },
        { key: "checkPrimary", ratio: contrastRatio(draft.primary, draft.background), min: CONTRAST_UI },
        { key: "checkAccent", ratio: contrastRatio(draft.accent, draft.background), min: CONTRAST_UI },
      ]
    : [];

  return (
    <div ref={ref} className="appearance-preview-wrap">
      <h2 id="preview-title">{t("previewTitle")}</h2>
      <div className="appearance-preview" style={style} role="group" aria-labelledby="preview-title">
        <p className="appearance-preview-brand">{storeName}</p>
        <p className="appearance-preview-heading">{draft.heading || storeName}</p>
        {draft.tagline && <p>{draft.tagline}</p>}
        <p>
          <span className="appearance-preview-link">{t("previewLink")}</span>
        </p>
        <span className="appearance-preview-button">{t("previewButton")}</span>
      </div>
      <ul className="appearance-checks" aria-live="polite">
        {checks.map((c) => (
          <li key={c.key} className={c.ratio >= c.min ? "notice" : "error"}>
            {t(c.key, { ratio: c.ratio.toFixed(2), min: c.min })} {c.ratio >= c.min ? t("checkPass") : t("checkFail")}
          </li>
        ))}
      </ul>
    </div>
  );
}
