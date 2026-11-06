export interface PersonTier {
  minPeople: number
  maxPeople: number
  pricePerPersonMinor: number
  includedMeats: number
  includedToppings: number
}

export interface OptionDef {
  id: string
  extraPriceMinor: number
}

export interface ConfigurableDef {
  tiers: PersonTier[]
  meats: OptionDef[]
  toppings: OptionDef[]
}

// weekdays: 0 = Sunday. dates: ISO YYYY-MM-DD. A rule matches on either.
export interface DateRule {
  id: string
  kind: 'fixed' | 'percent'
  value: number
  weekdays?: number[]
  dates?: string[]
}

export interface ShippingConfig {
  mode: 'zones' | 'approval' | 'fixed' | 'none'
  zones: { id: string; feeMinor: number }[]
  fixedFeeMinor: number
  prepay: boolean
}

export interface Deposit {
  kind: 'none' | 'percent' | 'fixed' | 'full'
  value: number
}

export interface PricedProduct {
  id: string
  kind: 'simple' | 'configurable'
  priceMinor: number
  fixedPrices: Record<string, number>
  configurable?: ConfigurableDef
  deposit: Deposit
}

export interface CartLine {
  lineId: string
  productId: string
  variantId?: string
  qty: number
  people?: number
  meats?: string[]
  toppings?: string[]
  date?: string
}

export interface QuoteInput {
  currency: string
  baseCurrency: string
  // Units of the base currency per 1 unit of the extra currency.
  rates: Record<string, number>
  products: PricedProduct[]
  lines: CartLine[]
  dateRules: DateRule[]
  shipping: ShippingConfig
  zoneId?: string
  orderDate?: string
  // Owner-quoted fee for `approval` mode, in base currency minor units.
  shippingFeeMinor?: number
}

export interface QuoteLine {
  lineId: string
  baseMinor: number
  extrasMinor: number
  dateMinor: number
  totalMinor: number
}

export interface QuoteError {
  lineId?: string
  code: string
}

export interface Quote {
  status: 'final' | 'pending_shipping' | 'pending_quote'
  lines: QuoteLine[]
  shipping: { status: 'final' | 'pending'; minor: number }
  subtotalMinor: number
  totalMinor: number | null
  depositDueMinor: number | null
  dueOnDeliveryMinor: number | null
  errors: QuoteError[]
}
