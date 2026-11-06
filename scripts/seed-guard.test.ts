import { describe, expect, it } from 'vitest'
import { assertSeedAllowed } from './seed-guard'

const base = {
  APP_ENV: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SEED_ADMIN_EMAIL: 'a@example.test',
  SEED_ADMIN_PASSWORD: 'x',
}

describe('assertSeedAllowed', () => {
  it('accepts local env with a local URL', () => {
    expect(() => assertSeedAllowed(base)).not.toThrow()
    expect(() => assertSeedAllowed({ ...base, SUPABASE_URL: 'http://localhost:54321' })).not.toThrow()
  })

  it.each([undefined, '', 'production', 'prod'])('refuses APP_ENV %s', (appEnv) => {
    expect(() => assertSeedAllowed({ ...base, APP_ENV: appEnv })).toThrow(/APP_ENV/)
  })

  it('refuses local env pointing at a remote URL', () => {
    expect(() =>
      assertSeedAllowed({ ...base, SUPABASE_URL: 'https://abc.supabase.co' }),
    ).toThrow(/local/)
  })

  it('refuses a missing or invalid URL', () => {
    expect(() => assertSeedAllowed({ ...base, SUPABASE_URL: undefined })).toThrow(/SUPABASE_URL/)
    expect(() => assertSeedAllowed({ ...base, SUPABASE_URL: 'nope' })).toThrow(/SUPABASE_URL/)
  })

  it('staging needs an https remote URL confirmed explicitly', () => {
    const staging = { ...base, APP_ENV: 'staging', SUPABASE_URL: 'https://abc.supabase.co' }
    expect(() => assertSeedAllowed(staging)).toThrow(/SEED_CONFIRM_URL/)
    expect(() =>
      assertSeedAllowed({ ...staging, SEED_CONFIRM_URL: 'https://other.supabase.co' }),
    ).toThrow(/SEED_CONFIRM_URL/)
    expect(() =>
      assertSeedAllowed({ ...staging, SEED_CONFIRM_URL: 'https://abc.supabase.co' }),
    ).not.toThrow()
    expect(() =>
      assertSeedAllowed({ ...staging, SUPABASE_URL: 'http://abc.supabase.co', SEED_CONFIRM_URL: 'http://abc.supabase.co' }),
    ).toThrow(/https/)
  })

  it('requires the admin credentials', () => {
    expect(() => assertSeedAllowed({ ...base, SEED_ADMIN_EMAIL: '' })).toThrow(/SEED_ADMIN_EMAIL/)
    expect(() => assertSeedAllowed({ ...base, SEED_ADMIN_PASSWORD: undefined })).toThrow(/SEED_ADMIN_PASSWORD/)
  })

  it('never echoes the credentials in errors', () => {
    try {
      assertSeedAllowed({ ...base, APP_ENV: 'production', SEED_ADMIN_PASSWORD: 'secret-pw' })
    } catch (e) {
      expect(String(e)).not.toContain('secret-pw')
      expect(String(e)).not.toContain('a@example.test')
    }
  })
})
