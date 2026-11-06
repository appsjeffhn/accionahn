import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { getSession, requireRole } from '@/lib/auth/session'
import { approveRequest, rejectRequest } from '@/lib/agency/requests'
import {
  createServiceClient,
  createSupabaseTenant,
} from '@/lib/agency/requests.store'

export const dynamic = 'force-dynamic'

async function approve(formData: FormData) {
  'use server'
  requireRole(await getSession(), 'agency_admin')
  const id = String(formData.get('id') ?? '')
  await approveRequest(id, { createTenant: createSupabaseTenant() })
  revalidatePath('/agency/requests')
}

async function reject(formData: FormData) {
  'use server'
  requireRole(await getSession(), 'agency_admin')
  await rejectRequest(String(formData.get('id') ?? ''))
  revalidatePath('/agency/requests')
}

type Row = {
  id: string
  business_name: string
  contact_email: string
  country: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export default async function RequestsPage() {
  requireRole(await getSession(), 'agency_admin')
  const t = await getTranslations('agency.requests')
  const { data, error } = await createServiceClient()
    .from('client_requests')
    .select('id, business_name, contact_email, country, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  const rows = (data ?? []) as Row[]

  return (
    <main>
      <h1>{t('title')}</h1>
      {rows.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('business')}</th>
              <th>{t('email')}</th>
              <th>{t('country')}</th>
              <th>{t('statusLabel')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.business_name}</td>
                <td>{r.contact_email}</td>
                <td>{r.country}</td>
                <td>{t(`status.${r.status}`)}</td>
                <td>
                  {r.status === 'pending' && (
                    <>
                      <form action={approve}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit">{t('approve')}</button>
                      </form>
                      <form action={reject}>
                        <input type="hidden" name="id" value={r.id} />
                        <button type="submit">{t('reject')}</button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
