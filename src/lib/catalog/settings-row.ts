import type { SupabaseClient } from '@supabase/supabase-js'

const UNIQUE_VIOLATION = '23505'

// Writes columns of a tenant's store_settings row without ever naming tenant_id in an
// UPDATE: service_role has no UPDATE on that column (20261106000022), so a PostgREST
// upsert (ON CONFLICT DO UPDATE SET tenant_id = ...) would be refused. Update by tenant
// first; when there is no row yet, insert it (column defaults for the rest); if another
// request inserted it meanwhile (23505), update once more.
export async function saveSettingsRow(
  supabase: SupabaseClient,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const update = async () => {
    const { data, error } = await supabase
      .from('store_settings')
      .update(values)
      .eq('tenant_id', tenantId)
      .select('tenant_id')
    if (error) throw error
    return (data ?? []).length > 0
  }

  if (await update()) return
  const { error } = await supabase.from('store_settings').insert({ tenant_id: tenantId, ...values })
  if (!error) return
  if (error.code !== UNIQUE_VIOLATION) throw error
  if (!(await update())) throw new Error('store_settings row vanished during save')
}
