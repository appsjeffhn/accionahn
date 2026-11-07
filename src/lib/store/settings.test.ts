import { describe, expect, it } from 'vitest'
import { parseDateRuleForm, parseSettingsForm, parseZoneForm } from './settings'

const RID = '44444444-4444-4444-8444-444444444444'

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item)
  }
  return fd
}

const ctx = { tenantId: 'tenant-a', baseCurrency: 'HNL', theme: { color: 'red' } }

const settings = {
  shippingMode: 'fixed',
  fixedFee: '80.00',
  shippingPrepay: 'on',
  'paymentInstructions.es': 'Transferir a BAC 123',
  'paymentInstructions.en': 'Transfer to BAC 123',
  holdHours: '24',
  timezone: 'America/Tegucigalpa',
}

describe('parseSettingsForm', () => {
  it('builds the settings write with the fee in base-currency minor units', () => {
    const r = parseSettingsForm(form(settings), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      tenantId: 'tenant-a',
      shippingMode: 'fixed',
      fixedFeeMinor: 8000,
      shippingPrepay: true,
      paymentInstructions: { es: 'Transferir a BAC 123', en: 'Transfer to BAC 123' },
      holdHours: 24,
      perLineDate: false,
      timezone: 'America/Tegucigalpa',
      theme: { color: 'red' },
    })
  })

  it('rejects hold_hours outside 1-168', () => {
    for (const holdHours of ['0', '169', '2.5', '', 'abc']) {
      const r = parseSettingsForm(form({ ...settings, holdHours }), ctx)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors.holdHours).toBe('holdHours')
    }
    expect(parseSettingsForm(form({ ...settings, holdHours: '168' }), ctx).ok).toBe(true)
  })

  it('rejects a timezone that does not exist', () => {
    for (const timezone of ['Mars/Olympus', 'GMT+6', '']) {
      const r = parseSettingsForm(form({ ...settings, timezone }), ctx)
      expect(r.ok).toBe(false)
      if (r.ok) continue
      expect(r.errors.timezone).toBe('timezone')
    }
  })

  it('rejects a malformed fee and an unknown shipping mode', () => {
    const r = parseSettingsForm(form({ ...settings, fixedFee: '80.001', shippingMode: 'drone' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.fixedFee).toBe('moneyFormat')
    expect(r.errors.shippingMode).toBe('invalid')
  })

  it('treats a blank fee as 0 when the mode does not use it', () => {
    const r = parseSettingsForm(form({ ...settings, shippingMode: 'zones', fixedFee: '' }), ctx)
    expect(r.ok && r.value.fixedFeeMinor).toBe(0)
  })

  it('reads the per-line date switch', () => {
    const r = parseSettingsForm(form({ ...settings, perLineDate: 'on' }), ctx)
    expect(r.ok && r.value.perLineDate).toBe(true)
  })
})

const rule = {
  id: RID,
  'label.es': 'Fin de semana',
  'label.en': 'Weekend',
  kind: 'fixed',
  value: '50.00',
  weekdays: ['0', '6'],
  dates: '',
}

describe('parseDateRuleForm', () => {
  it('reads a fixed rule in base-currency minor units with its weekdays', () => {
    const r = parseDateRuleForm(form(rule), ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({
      id: RID,
      tenantId: 'tenant-a',
      label: { es: 'Fin de semana', en: 'Weekend' },
      kind: 'fixed',
      value: 5000,
      weekdays: [0, 6],
      dates: [],
    })
  })

  it('reads a percent rule and dates separated by commas, spaces or lines', () => {
    const r = parseDateRuleForm(
      form({ ...rule, kind: 'percent', value: '12.5', weekdays: [], dates: '2026-12-24, 2026-12-31\n2027-01-01' }),
      ctx,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.value).toBe(12.5)
    expect(r.value.dates).toEqual(['2026-12-24', '2026-12-31', '2027-01-01'])
  })

  it('rejects a rule that matches nothing, a bad date and a bad value', () => {
    const none = parseDateRuleForm(form({ ...rule, weekdays: [] }), ctx)
    expect(!none.ok && none.errors.weekdays).toBe('ruleMatchesNothing')
    const date = parseDateRuleForm(form({ ...rule, dates: '2026-02-30' }), ctx)
    expect(!date.ok && date.errors.dates).toBe('date')
    const value = parseDateRuleForm(form({ ...rule, value: '5.555' }), ctx)
    expect(!value.ok && value.errors.value).toBe('moneyFormat')
    const pct = parseDateRuleForm(form({ ...rule, kind: 'percent', value: '-5' }), ctx)
    expect(!pct.ok && pct.errors.value).toBe('ruleValue')
  })

  it('rejects weekday values out of range', () => {
    const r = parseDateRuleForm(form({ ...rule, weekdays: ['9'] }), ctx)
    expect(!r.ok && r.errors.weekdays).toBe('weekday')
  })
})

describe('parseZoneForm', () => {
  const zone = { id: RID, 'label.es': 'Centro', 'label.en': 'Downtown', fee: '60', position: '2' }

  it('reads the zone fee in base-currency minor units', () => {
    const r = parseZoneForm(form(zone), ctx)
    expect(r.ok && r.value).toEqual({
      id: RID,
      tenantId: 'tenant-a',
      label: { es: 'Centro', en: 'Downtown' },
      feeMinor: 6000,
      position: 2,
    })
  })

  it('rejects a malformed fee and a missing label', () => {
    const r = parseZoneForm(form({ ...zone, fee: '6,000', 'label.es': '' }), ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.fee).toBe('moneyFormat')
    expect(r.errors['label.es']).toBe('textRequired')
  })

  it('defaults a blank position to 0', () => {
    const r = parseZoneForm(form({ ...zone, position: '' }), ctx)
    expect(r.ok && r.value.position).toBe(0)
  })
})
