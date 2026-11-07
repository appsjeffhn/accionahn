export const MAX_CONFIG_BYTES = 262_144

export class BotConfigNotFoundError extends Error {
  constructor(message = 'bot_config_version_not_found') {
    super(message)
    this.name = 'BotConfigNotFoundError'
  }
}

export class InvalidBotConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidBotConfigError'
  }
}

// Each method is one atomic step in the database (per-tenant serialized), so
// concurrent callers get distinct versions and exactly one published row.
export type BotConfigStore = {
  createDraft: (tenantId: string, config: Record<string, unknown>) => Promise<number>
  publish: (tenantId: string, version: number) => Promise<void>
  rollback: (tenantId: string) => Promise<number | null>
}

export type BotConfigDeps = { store?: BotConfigStore }

async function resolveStore(store?: BotConfigStore): Promise<BotConfigStore> {
  if (store) return store
  const { createSupabaseBotConfigStore } = await import('./versions.store')
  return createSupabaseBotConfigStore()
}

function assertValidConfig(config: unknown): asserts config is Record<string, unknown> {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new InvalidBotConfigError('config must be a JSON object')
  }
  if (new TextEncoder().encode(JSON.stringify(config)).length > MAX_CONFIG_BYTES) {
    throw new InvalidBotConfigError('config exceeds 256 KB')
  }
}

export async function createDraft(
  tenantId: string,
  config: unknown,
  deps: BotConfigDeps = {},
): Promise<{ version: number }> {
  assertValidConfig(config)
  const store = await resolveStore(deps.store)
  return { version: await store.createDraft(tenantId, config) }
}

export async function publish(
  tenantId: string,
  version: number,
  deps: BotConfigDeps = {},
): Promise<void> {
  const store = await resolveStore(deps.store)
  await store.publish(tenantId, version)
}

// Republishes the version published most recently before the current one, so calling
// it repeatedly toggles between the two most recent publications. Returns null (and
// changes nothing) when nothing is published or there is no previous publication.
export async function rollback(
  tenantId: string,
  deps: BotConfigDeps = {},
): Promise<{ version: number } | null> {
  const store = await resolveStore(deps.store)
  const version = await store.rollback(tenantId)
  return version === null ? null : { version }
}
