import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createSupabaseThemeStore } from '../store/appearance.store'
import { createSupabaseCatalogStore } from './catalog.store'
import { saveSettingsRow } from './settings-row'

const TENANT = '10000000-0000-4000-8000-00000000000a'

type Call = { op: string; table: string; values?: Record<string, unknown>; filters?: [string, unknown][] }

// Records what the stores send. `existing`: whether the tenant already has a settings
// row; `insertError`: what the insert answers (a concurrent insert gives 23505).
function fakeClient(opts: { existing: boolean; insertError?: { code: string } | null }) {
  const calls: Call[] = []
  let exists = opts.existing
  const client = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const call: Call = { op: 'update', table, values, filters: [] }
        calls.push(call)
        const q = {
          eq: (col: string, val: unknown) => {
            call.filters!.push([col, val])
            return q
          },
          select: async () => ({ data: exists ? [{ tenant_id: TENANT }] : [], error: null }),
        }
        return q
      },
      insert: async (values: Record<string, unknown>) => {
        calls.push({ op: 'insert', table, values })
        if (opts.insertError) {
          exists = true
          return { error: opts.insertError }
        }
        exists = true
        return { error: null }
      },
      upsert: async (values: Record<string, unknown>) => {
        calls.push({ op: 'upsert', table, values })
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('saveSettingsRow', () => {
  it('updates the existing row by tenant without ever writing tenant_id', async () => {
    const { client, calls } = fakeClient({ existing: true })
    await saveSettingsRow(client, TENANT, { theme: { accent: '#000000' } })
    expect(calls).toEqual([
      { op: 'update', table: 'store_settings', values: { theme: { accent: '#000000' } }, filters: [['tenant_id', TENANT]] },
    ])
  })

  it('inserts the row (with tenant_id) when the tenant has none yet', async () => {
    const { client, calls } = fakeClient({ existing: false })
    await saveSettingsRow(client, TENANT, { theme: {} })
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert'])
    expect(calls[1].values).toEqual({ tenant_id: TENANT, theme: {} })
  })

  it('a concurrent insert (23505) falls back to one more update', async () => {
    const { client, calls } = fakeClient({ existing: false, insertError: { code: '23505' } })
    await saveSettingsRow(client, TENANT, { hold_hours: 12 })
    expect(calls.map((c) => c.op)).toEqual(['update', 'insert', 'update'])
  })

  it('rethrows any other insert error', async () => {
    const { client } = fakeClient({ existing: false, insertError: { code: '42501' } })
    await expect(saveSettingsRow(client, TENANT, { hold_hours: 12 })).rejects.toMatchObject({ code: '42501' })
  })
})

describe('settings stores never upsert tenant_id', () => {
  it('createSupabaseCatalogStore.saveSettings updates the settings columns by tenant', async () => {
    const { client, calls } = fakeClient({ existing: true })
    await createSupabaseCatalogStore(client).saveSettings({
      tenantId: TENANT,
      shippingMode: 'fixed',
      fixedFeeMinor: 100,
      shippingPrepay: false,
      paymentInstructions: { es: '', en: '' },
      holdHours: 24,
      perLineDate: false,
      timezone: 'America/Tegucigalpa',
      theme: {},
    } as Parameters<ReturnType<typeof createSupabaseCatalogStore>['saveSettings']>[0])
    expect(calls.map((c) => c.op)).toEqual(['update'])
    expect(calls[0].values).not.toHaveProperty('tenant_id')
    expect(calls[0].filters).toEqual([['tenant_id', TENANT]])
  })

  it('createSupabaseThemeStore.saveTheme updates only theme by tenant', async () => {
    const { client, calls } = fakeClient({ existing: true })
    await createSupabaseThemeStore(client).saveTheme(TENANT, { accent: '#111111' } as never)
    expect(calls).toEqual([
      { op: 'update', table: 'store_settings', values: { theme: { accent: '#111111' } }, filters: [['tenant_id', TENANT]] },
    ])
  })
})
