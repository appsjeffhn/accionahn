import { describe, expect, it, vi } from 'vitest'
import { requirePanelSession, type PanelSessionDeps } from './panel-session'
import type { Session } from './session'

class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect ${to}`)
  }
}
class NotFound extends Error {}

function deps(session: Session | null): PanelSessionDeps & { getSession: ReturnType<typeof vi.fn> } {
  return {
    getSession: vi.fn(async () => session),
    redirect: (to: string) => {
      throw new Redirected(to)
    },
    notFound: () => {
      throw new NotFound()
    },
  }
}

const owner: Session = { userId: 'u', role: 'business_owner', tenantId: 'A' }
const admin: Session = { userId: 'a', role: 'agency_admin', tenantId: null }

describe('requirePanelSession', () => {
  it('returns the owner session on their own tenant host', async () => {
    await expect(requirePanelSession('A', deps(owner))).resolves.toBe(owner)
  })

  it('redirects to /login?next=/panel without a session', async () => {
    const err = await requirePanelSession('A', deps(null)).catch((e) => e)
    expect(err).toBeInstanceOf(Redirected)
    expect(err.to).toBe('/login?next=/panel')
  })

  it('is not found for an owner of another tenant', async () => {
    await expect(requirePanelSession('B', deps(owner))).rejects.toBeInstanceOf(NotFound)
  })

  it('is not found for an agency admin on a tenant host', async () => {
    await expect(requirePanelSession('A', deps(admin))).rejects.toBeInstanceOf(NotFound)
  })

  it('is not found without a host tenant, before reading the session', async () => {
    const d = deps(owner)
    await expect(requirePanelSession('', d)).rejects.toBeInstanceOf(NotFound)
    expect(d.getSession).not.toHaveBeenCalled()
  })
})
