import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../src/lib/agency/requests.store'
import { completeWizard } from '../src/lib/agency/wizard'
import { wizardInputSchema } from '../src/lib/agency/wizard-schema'
import { createSupabaseWizardStore } from '../src/lib/agency/wizard.store'
import { assertSeedAllowed } from './seed-guard'

const SLUG = 'spezia'

export const SPEZIA_INPUT = wizardInputSchema.parse({
  companyName: 'Spezia',
  slug: SLUG,
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }],
  // Fake number: the real owner alert phone is set from the agency panel.
  ownerAlertPhone: '+50400000000',
  orderFields: ['place', 'date', 'time', 'address', 'deposit'].map((key) => ({ key, required: true })),
  whatsappMode: 'evolution',
})

async function ensureTenant(supabase: SupabaseClient): Promise<{ id: string; created: boolean }> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id, status')
    .eq('slug', SLUG)
    .maybeSingle()
  if (error) throw error
  if (data?.status === 'active') return { id: data.id, created: false }

  let id = data?.id as string | undefined
  if (!id) {
    // Created with the final slug so an interrupted run resumes instead of duplicating.
    const insert = await supabase
      .from('tenants')
      .insert({ name: SPEZIA_INPUT.companyName, slug: SLUG, status: 'pending' })
      .select('id')
      .single()
    if (insert.error) throw insert.error
    id = insert.data.id as string
  }
  await completeWizard(id, SPEZIA_INPUT, { store: createSupabaseWizardStore(supabase) })
  return { id, created: true }
}

async function findUserId(supabase: SupabaseClient, email: string): Promise<string | null> {
  const wanted = email.toLowerCase()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === wanted)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
}

async function ensureAdmin(supabase: SupabaseClient, email: string, password: string): Promise<boolean> {
  let userId = await findUserId(supabase, email)
  const created = userId === null
  if (userId === null) {
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    userId = data.user.id
  }
  const { error } = await supabase
    .from('agency_admins')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (error) throw error
  return created
}

async function main(): Promise<void> {
  assertSeedAllowed(process.env)
  const supabase = createServiceClient()

  const tenant = await ensureTenant(supabase)
  const { error } = await supabase.from('tenants').update({ cohort: 'pilot' }).eq('id', tenant.id)
  if (error) throw error
  const adminCreated = await ensureAdmin(
    supabase,
    process.env.SEED_ADMIN_EMAIL as string,
    process.env.SEED_ADMIN_PASSWORD as string,
  )

  console.log(`Tenant '${SLUG}': ${tenant.created ? 'created' : 'already existed'} (cohort pilot).`)
  console.log(`Agency admin: ${adminCreated ? 'created' : 'already existed'}.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Seed failed')
  process.exit(1)
})
