import { describe, expect, it } from 'vitest'
import { ForbiddenError, type Session } from '../auth/session'
import { createMemoryFileStore, type FileStore } from '../storage/file-store'
import { PROOF_URL_SECONDS, type OrderSummary } from './orders-view'
import {
  getPanelOrder,
  listPanelOrders,
  signProofs,
  type PanelOrderDetail,
  type PanelOrdersStore,
} from './panel-orders'
import type { OrderStatus } from './states'

const TENANT_A = '10000000-0000-4000-8000-00000000000a'
const TENANT_B = '10000000-0000-4000-8000-00000000000b'
const OWNER_A: Session = { userId: '00000000-0000-4000-8000-0000000000a1', role: 'business_owner', tenantId: TENANT_A }
const ADMIN: Session = { userId: '00000000-0000-4000-8000-0000000000c1', role: 'agency_admin', tenantId: null }
const ORDER_A = '20000000-0000-4000-8000-00000000000a'
const ORDER_B = '20000000-0000-4000-8000-00000000000b'
const FILE_1 = '30000000-0000-4000-8000-000000000001'
const FILE_2 = '30000000-0000-4000-8000-000000000002'

function detail(id: string, tenantId: string, over: Partial<PanelOrderDetail> = {}): PanelOrderDetail {
  return {
    id,
    tenantId,
    status: 'awaiting_review',
    currency: 'HNL',
    baseCurrency: 'HNL',
    customerName: 'Ana',
    customerPhone: '+50499990000',
    fields: {},
    shippingFeeMinor: 0,
    shippingPrepay: false,
    subtotalMinor: 1000,
    totalMinor: 1000,
    depositDueMinor: 500,
    dueOnDeliveryMinor: 500,
    holdExpiresAt: null,
    createdAt: '2099-03-01T10:00:00Z',
    lines: [],
    events: [],
    proofs: [],
    ...over,
  }
}

function fakeStore(rows: PanelOrderDetail[]) {
  const calls: { list: { tenantId: string; status: OrderStatus | null }[]; get: { tenantId: string; id: string }[] } = {
    list: [],
    get: [],
  }
  const store: PanelOrdersStore = {
    async list(tenantId, status) {
      calls.list.push({ tenantId, status })
      return rows
        .filter((r) => r.tenantId === tenantId && (status === null || r.status === status))
        .map(
          (r): OrderSummary => ({
            id: r.id,
            status: r.status,
            currency: r.currency,
            customerName: r.customerName,
            totalMinor: r.totalMinor,
            createdAt: r.createdAt,
            hasPendingProof: false,
            reviewSince: null,
          }),
        )
    },
    async get(tenantId, id) {
      calls.get.push({ tenantId, id })
      // a store that forgets its tenant filter must still not leak (checked by the caller)
      return rows.find((r) => r.id === id) ?? null
    },
    async timeZone() {
      return 'America/Tegucigalpa'
    },
  }
  return { store, calls }
}

describe('listPanelOrders', () => {
  it('reads only the session tenant, with the status filter', async () => {
    const { store, calls } = fakeStore([detail(ORDER_A, TENANT_A), detail(ORDER_B, TENANT_B)])
    const result = await listPanelOrders(OWNER_A, { status: 'awaiting_review' }, { store })
    expect(result.orders.map((o) => o.id)).toEqual([ORDER_A])
    expect(result.timeZone).toBe('America/Tegucigalpa')
    expect(calls.list).toEqual([{ tenantId: TENANT_A, status: 'awaiting_review' }])
  })

  it('refuses anyone but a business owner', async () => {
    const { store } = fakeStore([])
    await expect(listPanelOrders(ADMIN, { status: null }, { store })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listPanelOrders(null, { status: null }, { store })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('getPanelOrder', () => {
  it('returns the order of the session tenant', async () => {
    const { store, calls } = fakeStore([detail(ORDER_A, TENANT_A)])
    expect((await getPanelOrder(OWNER_A, ORDER_A, { store }))?.id).toBe(ORDER_A)
    expect(calls.get).toEqual([{ tenantId: TENANT_A, id: ORDER_A }])
  })

  it('returns null for an order of another tenant, even if the store returned it', async () => {
    const { store } = fakeStore([detail(ORDER_B, TENANT_B)])
    expect(await getPanelOrder(OWNER_A, ORDER_B, { store })).toBeNull()
  })

  it('returns null for a malformed id without querying', async () => {
    const { store, calls } = fakeStore([])
    expect(await getPanelOrder(OWNER_A, 'not-a-uuid', { store })).toBeNull()
    expect(calls.get).toEqual([])
  })
})

describe('signProofs', () => {
  const proof = (id: string, path: string) => ({
    id,
    path,
    contentType: 'image/png',
    status: 'pending' as const,
    reason: null,
    createdAt: '2099-03-01T10:00:00Z',
  })

  it('signs each proof of this tenant and order for 5 minutes', async () => {
    const files = createMemoryFileStore()
    const path = `${TENANT_A}/${ORDER_A}/${FILE_1}`
    await files.put(path, new Uint8Array([1]), 'image/png')
    const order = detail(ORDER_A, TENANT_A, { proofs: [proof(FILE_1, path)] })
    const signed = await signProofs(OWNER_A, order, { files })
    expect(signed).toEqual([
      { id: FILE_1, contentType: 'image/png', status: 'pending', reason: null, createdAt: '2099-03-01T10:00:00Z', url: `memory://${path}?expires_in=${PROOF_URL_SECONDS}` },
    ])
    // the path itself is not handed to the page
    expect(signed[0]).not.toHaveProperty('path')
  })

  it('never signs a path outside <session tenant>/<order>/', async () => {
    const asked: string[] = []
    const files: FileStore = {
      put: async () => {},
      signedUrl: async (p) => {
        asked.push(p)
        return `signed:${p}`
      },
    }
    const order = detail(ORDER_A, TENANT_A, {
      proofs: [proof(FILE_1, `${TENANT_B}/${ORDER_A}/${FILE_1}`), proof(FILE_2, `${TENANT_A}/${ORDER_B}/${FILE_2}`)],
    })
    const signed = await signProofs(OWNER_A, order, { files })
    expect(signed.map((p) => p.url)).toEqual([null, null])
    expect(asked).toEqual([])
  })

  it('refuses an order of another tenant', async () => {
    const files = createMemoryFileStore()
    await expect(signProofs(OWNER_A, detail(ORDER_B, TENANT_B), { files })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('gives a null url when storage fails, without throwing', async () => {
    const files = createMemoryFileStore()
    const order = detail(ORDER_A, TENANT_A, { proofs: [proof(FILE_1, `${TENANT_A}/${ORDER_A}/${FILE_1}`)] })
    const signed = await signProofs(OWNER_A, order, { files })
    expect(signed[0].url).toBeNull()
  })
})
