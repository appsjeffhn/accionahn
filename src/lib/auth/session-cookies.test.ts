import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const created: { options: { cookieOptions?: Record<string, unknown> } }[] = []
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookieOptions?: Record<string, unknown> }) => {
    created.push({ options })
    return {}
  },
}))

const { createUserClient } = await import('./session')

function stubEnv(appEnv: string) {
  vi.stubEnv('APP_ENV', appEnv)
  vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321')
  vi.stubEnv('SUPABASE_ANON_KEY', 'anon-key-for-tests')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key-for-tests')
  vi.stubEnv('ROOT_DOMAIN', 'example.test')
}

beforeEach(() => {
  created.length = 0
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createUserClient session cookies', () => {
  it('are httpOnly and SameSite=Lax (no browser Supabase client reads them)', () => {
    stubEnv('local')
    createUserClient({ getAll: () => [] })
    expect(created[0].options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false })
  })

  it('are Secure outside local', () => {
    for (const env of ['staging', 'production']) {
      stubEnv(env)
      createUserClient({ getAll: () => [] })
      expect(created.at(-1)?.options.cookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true })
    }
  })
})
