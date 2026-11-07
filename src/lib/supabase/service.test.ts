import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServiceClient } from './service'

const SRC = join(__dirname, '..', '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('service-role client boundary', () => {
  it('service.ts is guarded by server-only', () => {
    const text = readFileSync(join(__dirname, 'service.ts'), 'utf8')
    expect(text).toMatch(/^import 'server-only'/m)
    expect(typeof createServiceClient).toBe('function')
  })

  it('no app module imports the unguarded core or builds its own service client', () => {
    const allowed = [join('supabase', 'service.ts'), join('supabase', 'service-core.ts'), join('lib', 'env.ts')]
    const offenders = sourceFiles(SRC)
      .filter((f) => !allowed.some((a) => f.endsWith(a)))
      .filter((f) => {
        const text = readFileSync(f, 'utf8')
        return /service-core/.test(text) || /SUPABASE_SERVICE_ROLE_KEY/.test(text)
      })
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
