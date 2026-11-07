import { createRateLimiter, hashedKey } from '../store/throttle'
import type { Session } from './session'

export type LoginResult = { ok: true } | { ok: false; error: 'invalid' }

// Only the fields used here; Supabase AuthError has `status` (0 or undefined when the
// request never reached the server) and `code`.
export type SignInError = { status?: number; code?: string }

export type LoginDeps = {
  signIn: (email: string, password: string) => Promise<{ error: SignInError | null }>
  signOut: () => Promise<void>
  // Runs after a successful sign in: true when the account may use this host.
  authorize: () => Promise<boolean>
  // App-level throttle, asked with the normalized email before Supabase is called;
  // false = too many attempts (answered with the same generic error).
  allow?: (email: string) => boolean
}

const MAX_EMAIL = 254
const MAX_PASSWORD = 1024
const MAX_NEXT = 2048
const INVALID: LoginResult = { ok: false, error: 'invalid' }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Unknown email, wrong password, unconfirmed email, rate limit (ours or Supabase's) and
// "no access on this host" all return the same result, so the form never reveals whether
// an account exists. Attempts are throttled here (deps.allow, see createLoginThrottle):
// Supabase Auth's per-IP limit sees the server's address (Vercel), not the visitor's, so
// it does not protect a single account from guessing.
export async function loginWithPassword(
  email: string,
  password: string,
  deps: LoginDeps,
): Promise<LoginResult> {
  const normalized = normalizeEmail(email)
  if (!normalized || normalized.length > MAX_EMAIL) return INVALID
  if (!password || password.length > MAX_PASSWORD) return INVALID
  if (deps.allow && !deps.allow(normalized)) return INVALID

  const { error } = await deps.signIn(normalized, password)
  if (error) {
    // Network failure or a Supabase outage: not the user's fault, so do not say "wrong password".
    if (!error.status || error.status >= 500) throw new Error('Authentication service unavailable')
    return INVALID
  }

  let allowed = false
  try {
    allowed = await deps.authorize()
  } finally {
    if (!allowed) await deps.signOut()
  }
  return allowed ? { ok: true } : INVALID
}

// Per-process login throttle (in memory, like the storefront's; a shared store is on the
// before-scaling list). Per client address: a burst of 10, then one attempt a minute.
// Per email (salted hash of the normalized address, whatever client tries it): a burst of
// 5, then one every 5 minutes. An attempt needs a token from both.
export function createLoginThrottle(opts: { now?: () => number } = {}) {
  const byClient = createRateLimiter({ capacity: 10, refillMs: 60_000, now: opts.now })
  const byEmail = createRateLimiter({ capacity: 5, refillMs: 5 * 60_000, now: opts.now })
  return {
    take({ client, email }: { client: string; email: string }): boolean {
      const clientOk = byClient.take(client)
      const emailOk = byEmail.take(hashedKey('email', normalizeEmail(email)))
      return clientOk && emailOk
    },
    keys: () => [...byClient.keys(), ...byEmail.keys()],
  }
}

// The agency host has no tenant id; every tenant host has one.
export function defaultNextPath(hostTenantId: string | null): '/panel' | '/agency' {
  return hostTenantId ? '/panel' : '/agency'
}

// Same rule as the middleware's canAccess: /panel belongs to the owner of the host's
// tenant, /agency to agency admins on the agency host.
export function sessionFitsHost(session: Session | null, hostTenantId: string | null): boolean {
  if (!session) return false
  if (hostTenantId === null) return session.role === 'agency_admin'
  return session.role === 'business_owner' && session.tenantId === hostTenantId
}

const BASE = 'http://next.invalid'

// Accepts only a same-origin path ("/x..."). Rejects protocol-relative ("//host"),
// backslash tricks ("/\host", which browsers read as "//host"), absolute and
// javascript: URLs, control characters and whitespace (browsers drop tabs/newlines,
// turning "/\t/host" into "//host") and encoded slashes or backslashes.
export function safeNextPath(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT) return fallback
  if (raw[0] !== '/' || raw[1] === '/') return fallback
  if (/[\\\u0000- \u007f]/.test(raw)) return fallback
  if (/%(2f|5c)/i.test(raw)) return fallback
  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback
  return `${url.pathname}${url.search}${url.hash}`
}
