import type { Session } from './session'

export type PanelSessionDeps = {
  getSession?: () => Promise<Session | null>
  redirect?: (to: string) => never
  notFound?: () => never
}

export const PANEL_LOGIN_PATH = '/login?next=/panel'

// Guard for every /panel page (the middleware already applies the same rule; this is
// the second line). The host tenant comes from the middleware's x-tenant-id header.
// Wrong tenant and agency admins get 404, so the panel never confirms who owns a store.
export async function requirePanelSession(
  hostTenantId: string,
  deps: PanelSessionDeps = {},
): Promise<Session> {
  // Explicit type: TypeScript only narrows after a `never` call through annotated names.
  const nav: { redirect: (to: string) => never; notFound: () => never } =
    deps.redirect && deps.notFound
      ? { redirect: deps.redirect, notFound: deps.notFound }
      : await import('next/navigation')
  if (!hostTenantId) nav.notFound()

  const getSession = deps.getSession ?? (await import('./session')).getSession
  const session = await getSession()
  if (!session) nav.redirect(PANEL_LOGIN_PATH)
  if (session.role !== 'business_owner' || session.tenantId !== hostTenantId) nav.notFound()
  return session
}
