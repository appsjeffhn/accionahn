import { defaultNextPath, safeNextPath } from './login'

export type CallbackPlan =
  | { kind: 'otp'; tokenHash: string; type: 'invite' | 'recovery'; then: string }
  | { kind: 'code'; code: string; then: string }
  | { kind: 'invalid' }

export const SET_PASSWORD_PATH = '/auth/set-password'

// What /auth/callback does with its query. The invitation email links here with
// token_hash and type=invite (custom template, see docs/environments.md); a code
// comes from a PKCE flow. Invitation and recovery continue to the set-password page.
export function planCallback(params: URLSearchParams, hostTenantId: string | null): CallbackPlan {
  const next = safeNextPath(params.get('next'), defaultNextPath(hostTenantId))
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  if (tokenHash && (type === 'invite' || type === 'recovery')) {
    return {
      kind: 'otp',
      tokenHash,
      type,
      then: `${SET_PASSWORD_PATH}?next=${encodeURIComponent(next)}`,
    }
  }
  const code = params.get('code')
  if (code && !tokenHash && !type) return { kind: 'code', code, then: next }
  return { kind: 'invalid' }
}

// /auth/set-password only works right after an emailed one-time link was verified,
// so a session opened with a password (or a stolen cookie) cannot silently change it.
export const SET_PASSWORD_WINDOW_S = 15 * 60
const LINK_METHODS = new Set(['invite', 'recovery', 'otp', 'magiclink'])
const CLOCK_SKEW_S = 60

// amr is the access token claim: [{ method, timestamp (unix seconds) }]. The plain
// string form carries no time, so it is refused.
export function canSetPassword(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false
  return amr.some((entry) => {
    if (!entry || typeof entry !== 'object') return false
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown }
    if (typeof method !== 'string' || !LINK_METHODS.has(method)) return false
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false
    const age = nowSeconds - timestamp
    return age <= SET_PASSWORD_WINDOW_S && age >= -CLOCK_SKEW_S
  })
}

export const MIN_PASSWORD = 12
// bcrypt, used by Supabase Auth, ignores bytes past 72.
export const MAX_PASSWORD = 72

export function checkNewPassword(
  password: string,
  confirm: string,
): 'tooShort' | 'tooLong' | 'mismatch' | null {
  if (password.length < MIN_PASSWORD) return 'tooShort'
  if (new TextEncoder().encode(password).length > MAX_PASSWORD) return 'tooLong'
  if (password !== confirm) return 'mismatch'
  return null
}
