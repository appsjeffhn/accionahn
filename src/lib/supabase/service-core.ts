import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseEnv } from '../env'

// Service-role client: bypasses RLS. App code must import it from './service', which
// carries the server-only guard; only trusted Node scripts (the seed) import this file.
export function createServiceClient(): SupabaseClient {
  const env = parseEnv(process.env)
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
