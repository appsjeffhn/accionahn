import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import { isRollout, type FlagStore } from './flags'

export function createSupabaseFlagStore(
  supabase: SupabaseClient = createServiceClient(),
): FlagStore {
  return {
    async list() {
      const { data, error } = await supabase
        .from('feature_flags')
        .select('key, rollout')
        .order('key')
      if (error) throw error
      return (data ?? []).flatMap((r) =>
        isRollout(r.rollout) ? [{ key: r.key as string, rollout: r.rollout }] : [],
      )
    },
    async set(key, next, changedBy) {
      const { data, error } = await supabase.rpc('set_feature_flag', {
        p_key: key,
        p_next: next,
        p_changed_by: changedBy,
      })
      if (error) throw error
      return data === true
    },
  }
}
