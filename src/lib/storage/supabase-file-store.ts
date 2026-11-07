import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '../supabase/service'
import type { FileStore } from './file-store'

// Private bucket for payment proofs, keyed <tenant_id>/<order_id>/<uuid>. Storage is not
// part of the local stack: the bucket is created (private, 4 MB limit, PROOF_MAX_BYTES) and this store is
// verified by hand on staging (docs/environments.md).
export const ORDER_PROOFS_BUCKET = 'order-proofs'

export function createSupabaseFileStore(
  bucket: string,
  supabase: SupabaseClient = createServiceClient(),
): FileStore {
  return {
    async put(path, bytes, contentType) {
      const { error } = await supabase.storage.from(bucket).upload(path, bytes, { contentType, upsert: false })
      if (error) throw error
    },
    async signedUrl(path, seconds) {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
      if (error) throw error
      return data.signedUrl
    },
  }
}
