import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const valid = {
  APP_ENV: 'local',
  ROOT_DOMAIN: 'accionahn.com',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
}

describe('parseEnv', () => {
  it('lanza con un mensaje que nombra las variables faltantes', () => {
    expect(() => parseEnv({})).toThrowError(/ROOT_DOMAIN/)
    expect(() => parseEnv({})).toThrowError(/SUPABASE_URL/)
  })

  it('rechaza un APP_ENV invalido', () => {
    expect(() => parseEnv({ ...valid, APP_ENV: 'prod' })).toThrow()
  })

  it('devuelve el entorno con valores validos', () => {
    expect(parseEnv(valid).ROOT_DOMAIN).toBe('accionahn.com')
  })

  it('CRON_SECRET es opcional en local', () => {
    expect(parseEnv(valid).CRON_SECRET).toBeUndefined()
    expect(parseEnv({ ...valid, CRON_SECRET: '' }).CRON_SECRET).toBeUndefined()
  })

  it('sin CRON_SECRET o con uno corto el entorno sigue siendo valido en staging y produccion (lo valida solo la ruta cron)', () => {
    for (const APP_ENV of ['staging', 'production']) {
      expect(parseEnv({ ...valid, APP_ENV }).CRON_SECRET).toBeUndefined()
      expect(parseEnv({ ...valid, APP_ENV, CRON_SECRET: 'short' }).CRON_SECRET).toBe('short')
      expect(parseEnv({ ...valid, APP_ENV, CRON_SECRET: 'a'.repeat(32) }).CRON_SECRET).toBe('a'.repeat(32))
    }
  })
})
