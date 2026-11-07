// Run with `pnpm seed:spezia`: the script passes --conditions=react-server so the
// server-only guard on the service-role stores resolves to its empty module in this
// trusted Node script (a plain `tsx scripts/seed-spezia.ts` fails on that guard).
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseCatalogStore } from '../src/lib/catalog/catalog.store'
import { parseEnv } from '../src/lib/env'
import { createSupabaseSetupStore } from '../src/lib/store/setup.store'
import { createServiceClient } from '../src/lib/supabase/service-core'
import { completeWizard } from '../src/lib/agency/wizard'
import { wizardInputSchema } from '../src/lib/agency/wizard-schema'
import { createSupabaseWizardStore } from '../src/lib/agency/wizard.store'
import { assertSeedAllowed } from './seed-guard'
import { seedSpeziaCatalog } from './seed-spezia-catalog'

const SLUG = 'spezia'

export const SPEZIA_INPUT = wizardInputSchema.parse({
  companyName: 'Spezia',
  slug: SLUG,
  defaultLocale: 'es',
  baseCurrency: 'HNL',
  extraCurrencies: [{ code: 'USD', mode: 'rate', rate: 25 }],
  // Fake number: the real owner alert phone is set afterwards (docs/environments.md, step 5).
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

  // Date rules, zones and the calendar tables are not writable by service_role: they are
  // written as the agency admin, under the same RLS policies the panel uses.
  const admin = await signInAsAdmin(process.env.SEED_ADMIN_EMAIL as string, process.env.SEED_ADMIN_PASSWORD as string)
  try {
    const { created } = await seedSpeziaCatalog(tenant.id, {
      env: process.env,
      catalog: createSupabaseCatalogStore(supabase),
      setup: createSupabaseSetupStore(admin),
    })
    const list = Object.entries(created).map(([k, n]) => `${k} ${n}`).join(', ')
    console.log(`Example catalog (EJEMPLO values, not real data). New rows: ${list}.`)
  } finally {
    await admin.auth.signOut()
  }
}

async function signInAsAdmin(email: string, password: string): Promise<SupabaseClient> {
  const env = parseEnv(process.env)
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  // Never echo the credentials: only say which step failed.
  if (error) throw new Error('Seed aborted: could not sign in as the seed admin (check SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).')
  return client
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Seed failed')
  process.exit(1)
})
