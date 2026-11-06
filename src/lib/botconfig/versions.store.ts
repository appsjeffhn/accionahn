import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../agency/requests.store'
import { BotConfigNotFoundError, type BotConfigStore } from './versions'

// P0002 is raised by the SQL functions for an unknown tenant or version.
function fail(error: { code?: string; message: string }): never {
  if (error.code === 'P0002') throw new BotConfigNotFoundError(error.message)
  throw error
}

export function createSupabaseBotConfigStore(
  supabase: SupabaseClient = createServiceClient(),
): BotConfigStore {
  return {
    async createDraft(tenantId, config) {
      const { data, error } = await supabase.rpc('create_bot_config_draft', {
        p_tenant: tenantId,
        p_config: config,
      })
      if (error) fail(error)
      return data as number
    },
    async publish(tenantId, version) {
      const { error } = await supabase.rpc('publish_bot_config', {
        p_tenant: tenantId,
        p_version: version,
      })
      if (error) fail(error)
    },
    async rollback(tenantId) {
      const { data, error } = await supabase.rpc('rollback_bot_config', {
        p_tenant: tenantId,
      })
      if (error) fail(error)
      return (data as number | null) ?? null
    },
  }
}
