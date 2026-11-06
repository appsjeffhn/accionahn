import { formatMinorInput } from "@/lib/catalog/form";
import type { ProductCalendarInput } from "@/lib/store/schema";

// Plain strings for the editor's default values (money as decimal strings).
export type EditorVariant = {
  id: string;
  labelEs: string;
  labelEn: string;
  sku: string;
  active: boolean;
  // null: stock not tracked
  stock: number | null;
};

export type EditorInitial = {
  id: string;
  kind: "simple" | "configurable";
  reservable: boolean;
  active: boolean;
  name: { es: string; en: string };
  description: { es: string; en: string };
  price: string;
  fixedPrices: Record<string, string>;
  depositKind: "none" | "percent" | "fixed" | "full";
  depositValue: string;
  variants: EditorVariant[];
  tiers: { minPeople: string; maxPeople: string; price: string; includedMeats: string; includedToppings: string }[];
  meats: { id: string; price: string }[];
  toppings: { id: string; price: string }[];
  calendar: Record<keyof Omit<ProductCalendarInput, "productId">, string>;
};

type Row = Record<string, unknown>;

const DEFAULT_CALENDAR: EditorInitial["calendar"] = {
  prepMinutes: "0",
  serviceMinutes: "60",
  bufferMinutes: "0",
  dailyLimit: "",
  slotStepMinutes: "30",
  minNoticeHours: "0",
  maxDaysAhead: "180",
};

export function emptyInitial(id: string): EditorInitial {
  return {
    id,
    kind: "simple",
    reservable: false,
    active: true,
    name: { es: "", en: "" },
    description: { es: "", en: "" },
    price: "",
    fixedPrices: {},
    depositKind: "none",
    depositValue: "",
    variants: [],
    tiers: [],
    meats: [],
    toppings: [],
    calendar: DEFAULT_CALENDAR,
  };
}

const text = (v: unknown) => {
  const o = (v ?? {}) as { es?: unknown; en?: unknown };
  return { es: typeof o.es === "string" ? o.es : "", en: typeof o.en === "string" ? o.en : "" };
};

export function toInitial(
  product: Row,
  variants: Row[],
  calendar: ProductCalendarInput | undefined,
  baseCurrency: string,
): EditorInitial {
  const money = (v: unknown) => formatMinorInput(Number(v ?? 0), baseCurrency);
  const deposit = (product.deposit ?? { kind: "none", value: 0 }) as { kind: EditorInitial["depositKind"]; value: number };
  const def = product.configurable as
    | {
        tiers: { minPeople: number; maxPeople: number; pricePerPersonMinor: number; includedMeats: number; includedToppings: number }[];
        meats: { id: string; extraPriceMinor: number }[];
        toppings: { id: string; extraPriceMinor: number }[];
      }
    | null;
  const fixed = (product.fixed_prices ?? {}) as Record<string, number>;
  return {
    id: String(product.id),
    kind: product.kind === "configurable" ? "configurable" : "simple",
    reservable: product.reservable === true,
    active: product.active === true,
    name: text(product.name),
    description: text(product.description),
    price: money(product.price_minor),
    fixedPrices: Object.fromEntries(Object.entries(fixed).map(([c, v]) => [c, formatMinorInput(v, c)])),
    depositKind: deposit.kind,
    depositValue:
      deposit.kind === "percent" ? String(deposit.value) : deposit.kind === "fixed" ? money(deposit.value) : "",
    variants: variants.map((v) => {
      const label = text(v.label);
      return {
        id: String(v.id),
        labelEs: label.es,
        labelEn: label.en,
        sku: typeof v.sku === "string" ? v.sku : "",
        active: v.active === true,
        stock: v.stock === null || v.stock === undefined ? null : Number(v.stock),
      };
    }),
    tiers: (def?.tiers ?? []).map((t) => ({
      minPeople: String(t.minPeople),
      maxPeople: String(t.maxPeople),
      price: money(t.pricePerPersonMinor),
      includedMeats: String(t.includedMeats),
      includedToppings: String(t.includedToppings),
    })),
    meats: (def?.meats ?? []).map((m) => ({ id: m.id, price: money(m.extraPriceMinor) })),
    toppings: (def?.toppings ?? []).map((m) => ({ id: m.id, price: money(m.extraPriceMinor) })),
    calendar: calendar
      ? {
          prepMinutes: String(calendar.prepMinutes),
          serviceMinutes: String(calendar.serviceMinutes),
          bufferMinutes: String(calendar.bufferMinutes),
          dailyLimit: calendar.dailyLimit === null ? "" : String(calendar.dailyLimit),
          slotStepMinutes: String(calendar.slotStepMinutes),
          minNoticeHours: String(calendar.minNoticeHours),
          maxDaysAhead: String(calendar.maxDaysAhead),
        }
      : DEFAULT_CALENDAR,
  };
}
