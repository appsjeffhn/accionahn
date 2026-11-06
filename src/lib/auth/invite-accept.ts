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
