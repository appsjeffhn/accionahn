import type { SupabaseClient } from '@supabase/supabase-js'
import { saveSettingsRow } from '../catalog/settings-row'
import { createServiceClient } from '../supabase/service'
import type { ThemeStore } from './appearance'

// Only the theme column: updates theme on the tenant's row, or inserts the row with the
// column defaults for the rest. Called after saveAppearance has taken the tenant from the
// owner's session.
export function createSupabaseThemeStore(supabase: SupabaseClient = createServiceClient()): ThemeStore {
  return {
    async saveTheme(tenantId, theme) {
      await saveSettingsRow(supabase, tenantId, { theme })
    },
  }
}
