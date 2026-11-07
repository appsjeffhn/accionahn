import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import es from '../../../messages/es.json'
import { ORDER_FIELD_KEYS } from '../agency/wizard-schema'
import { ORDER_STATUSES } from '../orders/states'
import { INPUT_FIELD_KEYS, NOTES_KEY, STORE_ERROR_KEYS } from '../store/checkout'

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

describe('message catalogs', () => {
  it('es and en have exactly the same keys', () => {
    expect(keys(es).sort()).toEqual(keys(en).sort())
  })
  it('have a catalog.errors message for every error key the schemas and panel produce', () => {
    const sources = [
      'src/lib/catalog/schema.ts',
      'src/lib/store/schema.ts',
      'src/lib/store/theme.ts',
      'src/lib/catalog/form.ts',
      'src/app/(owner)/panel/session.ts',
      'src/app/(owner)/panel/products/actions.ts',
      'src/app/(owner)/panel/orders/actions.ts',
    ].map((f) => readFileSync(f, 'utf8'))
    const used = new Set<string>()
    for (const src of sources) {
      for (const m of src.matchAll(/\bE\('(\w+)'\)|int\('(\w+)'|'(moneyFormat)'|\w+: "(\w+)" ?}\)/g)) {
        used.add(m[1] ?? m[2] ?? m[3] ?? m[4])
      }
    }
    expect(used.size).toBeGreaterThan(30)
    const errors = (es as { catalog: { errors: Record<string, string> } }).catalog.errors
    expect([...used].filter((k) => !(k in errors))).toEqual([])
  })

  it('have a catalog.errors message for every logo upload error', () => {
    for (const catalog of [es, en] as { catalog: { errors: Record<string, string> } }[]) {
      expect(['logoType', 'logoSize', 'logoPath'].filter((k) => !(k in catalog.catalog.errors))).toEqual([])
    }
  })

  it('the owner invitation tells "sent" from "set-password link resent"', () => {
    for (const catalog of [es, en] as unknown as { wizard: { invite: Record<string, string> } }[]) {
      expect(catalog.wizard.invite).toHaveProperty('sent')
      expect(catalog.wizard.invite).toHaveProperty('resent')
    }
    expect((es as unknown as { wizard: { invite: { resent: string } } }).wizard.invite.resent).toBe(
      'Se envió un enlace para establecer la contraseña.',
    )
  })

  it('have a store.errors message for every key the storefront can show', () => {
    for (const catalog of [es, en] as { store: { errors: Record<string, string> } }[]) {
      const missing = [...STORE_ERROR_KEYS, 'checkFields'].filter((k) => !(k in catalog.store.errors))
      expect(missing).toEqual([])
    }
  })

  it('label every order status and every customer order field in the store', () => {
    const store = (es as unknown as { store: { order: { status: object; statusHelp: object }; fields: object } }).store
    for (const s of ORDER_STATUSES) {
      expect(store.order.status).toHaveProperty(s)
      expect(store.order.statusHelp).toHaveProperty(s)
    }
    // trackingDisplay: the payment deadline passed before the expiry job ran
    expect(store.order).toHaveProperty('expired.status')
    expect(store.order).toHaveProperty('expired.help')
    for (const k of [...INPUT_FIELD_KEYS, NOTES_KEY]) expect(store.fields).toHaveProperty(k)
  })

  it('label every order field key in the panel order detail, in es and en', () => {
    for (const catalog of [es, en] as unknown as { panel: { orders: { fields: object } } }[]) {
      const missing = [...ORDER_FIELD_KEYS, NOTES_KEY].filter((k) => !(k in catalog.panel.orders.fields))
      expect(missing).toEqual([])
    }
  })

  it('contain the login, agency and wizard namespaces', () => {
    for (const ns of ['login', 'agency', 'wizard']) {
      expect(Object.keys(es)).toContain(ns)
    }
  })
})
