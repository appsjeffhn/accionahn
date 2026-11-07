import { describe, expect, it } from 'vitest'
import { assertSeedAllowed } from './seed-guard'

const base = {
  APP_ENV: 'local',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SEED_ADMIN_EMAIL: 'a@example.test',
  SEED_ADMIN_PASSWORD: 'Zk9-unit-test-pw-16',
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

  it.each(['', 'change-me-before-running', 'changeme', 'password', 'CHANGEME', 'short-pw-11'])(
    'rejects weak or placeholder password %j',
    (pw) => {
      expect(() => assertSeedAllowed({ ...base, SEED_ADMIN_PASSWORD: pw })).toThrow(/SEED_ADMIN_PASSWORD/)
    },
  )

  it('accepts a 16 character non-placeholder password', () => {
    expect(() => assertSeedAllowed({ ...base, SEED_ADMIN_PASSWORD: 'abcd-efgh-ijkl-mn' })).not.toThrow()
  })

  it.each([
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://127.0.0.1@evil.com',
  ])('refuses lookalike local URL %s', (url) => {
    expect(() => assertSeedAllowed({ ...base, SUPABASE_URL: url })).toThrow(/local/)
  })

  it('treats [::1] as local', () => {
    expect(() => assertSeedAllowed({ ...base, SUPABASE_URL: 'http://[::1]:54321' })).not.toThrow()
  })

  it('never echoes the credentials in errors', () => {
    expect.assertions(8)
    const secret = 'secret-pw-not-echoed'
    const cases = [
      { ...base, APP_ENV: 'production', SEED_ADMIN_PASSWORD: secret },
      { ...base, SUPABASE_URL: 'https://abc.supabase.co', SEED_ADMIN_PASSWORD: secret },
      { ...base, SEED_ADMIN_PASSWORD: 'changeme' },
      { ...base, SEED_ADMIN_PASSWORD: 'tiny' },
    ]
    for (const env of cases) {
      try {
        assertSeedAllowed(env)
      } catch (e) {
        expect(String(e)).not.toContain(env.SEED_ADMIN_PASSWORD)
        expect(String(e)).not.toContain('a@example.test')
      }
    }
  })
})
