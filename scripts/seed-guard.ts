type SeedEnv = Record<string, string | undefined>

const PLACEHOLDER_PASSWORDS = new Set(['change-me-before-running', 'changeme', 'password'])
const MIN_PASSWORD_LENGTH = 12

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseUrl(raw: string | undefined): URL {
  if (!raw) throw new Error('Seed aborted: SUPABASE_URL is not set.')
  try {
    return new URL(raw)
  } catch {
    throw new Error('Seed aborted: SUPABASE_URL is not a valid URL.')
  }
}

// Runs before any network call. Throws with a message that never includes secrets.
export function assertSeedAllowed(env: SeedEnv): void {
  const appEnv = env.APP_ENV
  if (appEnv !== 'local' && appEnv !== 'staging') {
    throw new Error(
      `Seed aborted: APP_ENV must be 'local' or 'staging' (got ${appEnv ? `'${appEnv}'` : 'nothing'}). It never runs against production.`,
    )
  }

  const url = parseUrl(env.SUPABASE_URL)
  const isLocal = LOCAL_HOSTS.has(url.hostname)

  if (appEnv === 'local' && !isLocal) {
    throw new Error('Seed aborted: APP_ENV=local requires a local SUPABASE_URL (localhost or 127.0.0.1).')
  }
  if (appEnv === 'staging') {
    if (isLocal) throw new Error('Seed aborted: APP_ENV=staging needs the staging Supabase URL, not a local one.')
    if (url.protocol !== 'https:') throw new Error('Seed aborted: the staging SUPABASE_URL must use https.')
    // A remote project cannot be recognised by name, so the operator must retype its URL.
    if (env.SEED_CONFIRM_URL !== env.SUPABASE_URL) {
      throw new Error('Seed aborted: set SEED_CONFIRM_URL to the exact staging SUPABASE_URL to confirm the target.')
    }
  }

  if (!env.SEED_ADMIN_EMAIL) throw new Error('Seed aborted: SEED_ADMIN_EMAIL is not set.')
  const password = env.SEED_ADMIN_PASSWORD
  if (!password) throw new Error('Seed aborted: SEED_ADMIN_PASSWORD is not set.')
  if (password.length < MIN_PASSWORD_LENGTH || PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) {
    throw new Error(
      `Seed aborted: SEED_ADMIN_PASSWORD is a placeholder or shorter than ${MIN_PASSWORD_LENGTH} characters. Set a real password in your shell.`,
    )
  }
}
