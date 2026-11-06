// Private file storage (payment proofs, later logos). Supabase Storage does not run in the
// local stack, so code depends on this interface: tests use the in-memory store below,
// deployed environments use createSupabaseFileStore (supabase-file-store.ts).
export type FileStore = {
  // Never overwrites: putting an existing path fails.
  put: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>
  // Short-lived URL to read one private file; generated per request, never stored.
  signedUrl: (path: string, seconds: number) => Promise<string>
}

export type MemoryFileStore = FileStore & {
  files: Map<string, { bytes: Uint8Array; contentType: string }>
}

export function createMemoryFileStore(): MemoryFileStore {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>()
  return {
    files,
    async put(path, bytes, contentType) {
      if (files.has(path)) throw new Error(`file already exists: ${path}`)
      files.set(path, { bytes: bytes.slice(), contentType })
    },
    async signedUrl(path, seconds) {
      if (!files.has(path)) throw new Error(`no such file: ${path}`)
      if (!Number.isInteger(seconds) || seconds <= 0) throw new RangeError('seconds must be a positive integer')
      return `memory://${path}?expires_in=${seconds}`
    },
  }
}
