import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import type { ThemeStore } from './appearance'

// Only the theme column: an upsert that names tenant_id and theme updates just theme on
// an existing row and inserts the column defaults for the rest otherwise. Called after
// saveAppearance has taken the tenant from the owner's session.
export function createSupabaseThemeStore(supabase: SupabaseClient = createServiceClient()): ThemeStore {
  return {
    async saveTheme(tenantId, theme) {
      const { error } = await supabase
        .from('store_settings')
        .upsert({ tenant_id: tenantId, theme }, { onConflict: 'tenant_id' })
      if (error) throw error
    },
  }
}
