# Plan 1: Base multi-tenant y panel de agencia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una app Next.js multi-tenant en la que la agencia aprueba un cliente, lo configura con un wizard y controla qué mejoras recibe, con aislamiento de datos por cliente garantizado por pruebas.

**Architecture:** Una sola app Next.js (App Router) en Vercel. El tenant se resuelve por el host (subdominio de `accionahn.com` o dominio propio). Supabase aporta Auth y Postgres; el aislamiento entre clientes lo hace RLS, probado con pgTAP. Las mejoras se controlan con flags por cohorte (`pilot` / `general`) y con configuración del bot versionada.

**Tech Stack:** Next.js (App Router) + TypeScript, pnpm, Supabase (Auth, Postgres, RLS, CLI local), next-intl, zod, vitest, pgTAP (`supabase test db`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-05-accionahn-bot-platform-design.md` (secciones 3, 4, 5.1, 6.1). Este plan cubre el proyecto 1 del orden de construcción. Los proyectos 2 (tienda e inventario) y 3 (cerebro del bot, medición de costos, tablero de consumo y de calidad) tienen plan aparte; el tablero de consumo y el de calidad del panel de agencia NO están aquí.

## Global Constraints

- Una sola aplicación Next.js en Vercel para todos los clientes; subdominios bajo wildcard de `accionahn.com`.
- Supabase como base de datos única; aislamiento por cliente con RLS.
- Español e inglés desde el hito 1 (tienda, bot, panel del cliente, panel de agencia).
- Roles: agencia, dueño del negocio (varios usuarios por negocio, sin departamentos, un usuario pertenece a un solo negocio).
- Moneda base por tienda más monedas adicionales; en cada moneda adicional el dueño elige precio manual o tipo de cambio que él define; sin tipo de cambio automático.
- Tope de IA por cliente: US$5 al mes por defecto (500 centavos); mes calendario.
- Retención de conversaciones configurable por cliente, 12 meses por defecto.
- Avisos solo al dueño, a un número de contacto aparte definido en el wizard.
- Migraciones de base de datos siempre compatibles hacia atrás (no se revierten, se corrigen hacia adelante).
- Hito 1 solo con subdominios de `accionahn.com`; dominio propio y compra de dominios quedan fuera.
- Staging y producción separados; el cliente piloto es Spezia.

## Review Focus

1. Host con mayúsculas, puerto, punto final o prefijo `www.` resuelve al mismo tenant; un host desconocido da 404, nunca el tenant de otro. (Task 3)
2. Subdominios reservados (`www`, `app`, `admin`, `api`, `staging`) y duplicados se rechazan al elegir el slug. (Task 7)
3. Dueño sin membresía, o de un tenant suspendido, no obtiene sesión; un usuario con dos membresías es imposible por esquema. (Tasks 2 y 4)
4. Wizard con moneda inválida, moneda extra repetida o igual a la base, teléfono que no es E.164, o tipo de cambio ≤ 0, se rechaza con error por campo. (Task 7)
5. Publicar dos versiones de configuración al mismo tiempo deja una sola publicada; hacer rollback con una sola versión no rompe nada. (Task 9)

## File Structure

```
src/lib/env.ts                  # parseEnv
src/lib/tenancy/{resolve.ts,reserved.ts}
src/lib/auth/{session.ts,guards.ts}
src/lib/i18n/{locale.ts,config.ts}   messages/{es.json,en.json}
src/lib/agency/{requests.ts,wizard-schema.ts,wizard.ts}
src/lib/flags/{flags.ts,actions.ts}
src/lib/botconfig/versions.ts
src/middleware.ts
src/app/(agency)/agency/...     # panel de agencia
src/app/(owner)/panel/...       # shell del panel del cliente (vacío salvo layout)
supabase/migrations/*.sql   supabase/tests/*.sql
scripts/{seed-spezia.ts,check-migration-safety.ts}
.github/workflows/ci.yml
```

---

### Task 1: Scaffold, entorno y CI

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `supabase/config.toml` (vía `supabase init`)
- Create: `src/lib/env.ts`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Produces: `type Env = { APP_ENV: 'local'|'staging'|'production'; ROOT_DOMAIN: string; SUPABASE_URL: string; SUPABASE_ANON_KEY: string; SUPABASE_SERVICE_ROLE_KEY: string }` y `parseEnv(raw: Record<string, string | undefined>): Env`.

- [ ] **Step 1: Write the failing test** `env.test.ts`: `parseEnv({})` lanza un error cuyo mensaje contiene `ROOT_DOMAIN` y `SUPABASE_URL`; `parseEnv({...todas, APP_ENV:'prod'})` lanza; con valores válidos devuelve `ROOT_DOMAIN === 'accionahn.com'`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/env.test.ts`. Expected: FAIL, `parseEnv` no definido.
- [ ] **Step 3: Scaffold** el proyecto con `pnpm create next-app` (TypeScript, App Router, src dir), instalar vitest, zod y next-intl, ejecutar `supabase init`, e implementar `parseEnv` con zod en `src/lib/env.ts`.
- [ ] **Step 4: CI** en `.github/workflows/ci.yml`: jobs `lint`, `unit` (`pnpm vitest run`) y `db` (`supabase start && supabase test db`).
- [ ] **Step 5: Run** `pnpm vitest run`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: scaffold app, env parsing and CI`.

### Task 2: Esquema de tenancy y RLS

**Files:**
- Create: `supabase/migrations/20261106000001_tenancy.sql`
- Test: `supabase/tests/rls_tenancy.test.sql`

**Interfaces:**
- Produces tablas: `tenants(id uuid pk, slug text unique, name text, status text check in ('pending','active','suspended'), cohort text check in ('pilot','general') default 'general', default_locale text check in ('es','en'), base_currency text, enabled_currencies text[], settings jsonb, created_at)`, `tenant_domains(hostname text unique, tenant_id, kind text check in ('subdomain','custom'))`, `memberships(user_id uuid unique, tenant_id, role text check in ('owner','staff'))`, `agency_admins(user_id uuid pk)`.
- Produces funciones SQL: `auth_tenant_id() returns uuid` e `is_agency_admin() returns boolean`.

- [ ] **Step 1: Write the failing pgTAP test** con tres usuarios sembrados (dueño de A, dueño de B, admin de agencia) y estas aserciones: el dueño A ve 1 fila en `tenants` y es la de A; un `update tenants` del dueño A sobre B afecta 0 filas; `anon` ve 0 filas; el admin ve 2; insertar una segunda `membership` para el mismo `user_id` viola la restricción única.
- [ ] **Step 2: Run** `supabase test db`. Expected: FAIL, las tablas no existen.
- [ ] **Step 3: Write the migration** con las tablas, las dos funciones y las políticas RLS: el dueño solo lee y modifica su `tenant_id`; el admin tiene acceso total; `anon` sin acceso.
- [ ] **Step 4: Run** `supabase test db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): tenancy schema with RLS`.

### Task 3: Resolución de tenant por host

**Files:**
- Create: `src/lib/tenancy/resolve.ts`, `src/lib/tenancy/reserved.ts`, `src/middleware.ts`
- Test: `src/lib/tenancy/resolve.test.ts`

**Interfaces:**
- Consumes: `Env.ROOT_DOMAIN` (Task 1), tabla `tenant_domains` (Task 2).
- Produces: `normalizeHost(host: string): string`; `type Tenant = { id: string; slug: string; name: string; status: 'pending'|'active'|'suspended'; cohort: 'pilot'|'general'; defaultLocale: 'es'|'en'; baseCurrency: string; enabledCurrencies: string[] }`; `resolveTenant(host: string, lookup: (hostname: string) => Promise<Tenant | null>): Promise<Tenant | null>`; `RESERVED_SLUGS: readonly string[]`.

- [ ] **Step 1: Write the failing tests:** `normalizeHost('Spezia.AccionaHN.com:3000.')` es `'spezia.accionahn.com'`; `normalizeHost('www.spezia.accionahn.com')` es `'spezia.accionahn.com'`; `resolveTenant('desconocido.accionahn.com', async () => null)` devuelve `null`; `lookup` recibe siempre el host normalizado; `RESERVED_SLUGS` contiene `www`, `app`, `admin`, `api`, `staging`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/tenancy`. Expected: FAIL.
- [ ] **Step 3: Implement** las tres funciones en `resolve.ts` y `reserved.ts`. El middleware llama a `resolveTenant`, adjunta el tenant a un header interno y devuelve 404 si es `null` (excepto en el host de la agencia).
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat: resolve tenant from host`.

### Task 4: Sesión y roles

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/guards.ts`
- Test: `src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `Tenant` (Task 3), tablas `memberships` y `agency_admins` (Task 2).
- Produces: `type Session = { userId: string; role: 'agency_admin'|'business_owner'; tenantId: string | null }`; `deriveSession(input: { userId: string; isAgencyAdmin: boolean; membership: { tenantId: string; tenantStatus: Tenant['status'] } | null }): Session | null`; `requireRole(session: Session | null, role: Session['role']): Session` (lanza `ForbiddenError`).

- [ ] **Step 1: Write the failing tests:** admin → `{role:'agency_admin', tenantId:null}`; membresía con tenant `active` → `business_owner` con su `tenantId`; sin membresía → `null`; membresía con tenant `suspended` → `null`; `requireRole` lanza `ForbiddenError` si el rol no coincide o la sesión es `null`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/auth`. Expected: FAIL.
- [ ] **Step 3: Implement** `deriveSession` y `requireRole`, y el envoltorio `getSession()` que lee el usuario de Supabase Auth y consulta las dos tablas. Proteger `/agency/*` con rol `agency_admin` y `/panel/*` con `business_owner` y tenant igual al del host.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat: session derivation and role guards`.

### Task 5: Internacionalización es/en

**Files:**
- Create: `src/lib/i18n/locale.ts`, `src/lib/i18n/config.ts`, `messages/es.json`, `messages/en.json`
- Test: `src/lib/i18n/locale.test.ts`, `src/lib/i18n/messages.test.ts`

**Interfaces:**
- Produces: `type Locale = 'es' | 'en'`; `resolveLocale(input: { cookie?: string; acceptLanguage?: string; tenantDefault?: Locale }): Locale` con prioridad cookie, luego `Accept-Language`, luego idioma por defecto del tenant, luego `'es'`.

- [ ] **Step 1: Write the failing tests:** `resolveLocale` respeta la prioridad (cookie `en` gana sobre `Accept-Language: es`); `Accept-Language: 'fr-FR,en;q=0.8'` da `'en'`; sin nada da `'es'`; y `messages.test.ts` afirma que `es.json` y `en.json` tienen exactamente el mismo conjunto de claves anidadas.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/i18n`. Expected: FAIL.
- [ ] **Step 3: Implement** `resolveLocale`, configurar next-intl y crear los catálogos con las claves de login, panel de agencia y wizard.
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat: es/en i18n with key parity test`.

### Task 6: Solicitudes de clientes y aprobación

**Files:**
- Create: `supabase/migrations/20261106000002_client_requests.sql`, `src/lib/agency/requests.ts`, `src/app/(agency)/agency/requests/page.tsx`
- Test: `supabase/tests/rls_requests.test.sql`, `src/lib/agency/requests.test.ts`

**Interfaces:**
- Consumes: `tenants`, `is_agency_admin()` (Task 2).
- Produces: tabla `client_requests(id uuid pk, business_name, contact_email, country, status check in ('pending','approved','rejected') default 'pending', tenant_id uuid null)`; `approveRequest(requestId: string, deps: { createTenant: (name: string) => Promise<Tenant> }): Promise<Tenant>` que deja la solicitud `approved` y el tenant en `pending`.

- [ ] **Step 1: Write the failing tests:** pgTAP: `anon` puede insertar con `status='pending'` pero no con `'approved'` y no puede leer; solo el admin lee y actualiza. Vitest: `approveRequest` sobre una solicitud `rejected` lanza; sobre una `pending` crea el tenant una sola vez aunque se llame dos veces seguidas.
- [ ] **Step 2: Run** `supabase test db` y `pnpm vitest run src/lib/agency/requests.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** la migración, `approveRequest` (idempotente) y la página de lista con botones aprobar y rechazar.
- [ ] **Step 4: Run** ambos comandos. Expected: PASS.
- [ ] **Step 5: Commit** `feat: client requests and approval`.

### Task 7: Wizard de configuración del cliente

**Files:**
- Create: `src/lib/agency/wizard-schema.ts`, `src/lib/agency/wizard.ts`, `src/app/(agency)/agency/tenants/[id]/wizard/page.tsx`
- Test: `src/lib/agency/wizard-schema.test.ts`, `src/lib/agency/wizard.test.ts`

**Interfaces:**
- Consumes: `RESERVED_SLUGS` (Task 3), `Tenant` (Task 3), tablas `tenants` y `tenant_domains` (Task 2).
- Produces: `wizardInputSchema` (zod) con `companyName`, `slug`, `defaultLocale: 'es'|'en'`, `baseCurrency` (ISO 4217), `extraCurrencies: { code: string; mode: 'manual'|'rate'; rate?: number }[]`, `ownerAlertPhone` (E.164), `orderFields: { key: 'place'|'date'|'time'|'address'|'deposit'|'shipping_cost'; required: boolean }[]`, `whatsappMode: 'evolution'|'cloud_api'`, `aiCapCents` (default 500), `retentionMonths` (default 12); `isSlugAvailable(slug: string, deps: { exists: (slug: string) => Promise<boolean> }): Promise<boolean>`; `completeWizard(tenantId: string, input: WizardInput, deps): Promise<Tenant>` que pone el tenant en `active`, guarda `settings` y crea el host `${slug}.accionahn.com` en `tenant_domains`.

- [ ] **Step 1: Write the failing tests:** el schema acepta el caso Spezia (base `HNL`, extra `USD` modo `rate` con `rate: 25`, campos `place,date,time,address,deposit` requeridos, teléfono `+50499999999`) y aplica los defaults 500 y 12; rechaza `baseCurrency: 'XXX1'`, una extra igual a la base, una extra repetida, teléfono `99999999`, `rate: 0`, y `rate` ausente cuando `mode:'rate'`; `isSlugAvailable('admin', ...)` es `false` por reservado; `isSlugAvailable('spezia', exists→true)` es `false`; `completeWizard` deja el tenant `active` con dominio `spezia.accionahn.com`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/agency`. Expected: FAIL.
- [ ] **Step 3: Implement** el schema y las dos funciones; el formulario del wizard valida con el mismo schema y muestra errores por campo (textos en `messages/es.json` y `messages/en.json`).
- [ ] **Step 4: Run** el mismo comando. Expected: PASS.
- [ ] **Step 5: Commit** `feat: client onboarding wizard`.

### Task 8: Flags de liberación por cohorte

**Files:**
- Create: `supabase/migrations/20261106000003_feature_flags.sql`, `src/lib/flags/flags.ts`, `src/lib/flags/actions.ts`, `src/app/(agency)/agency/releases/page.tsx`
- Test: `supabase/tests/rls_flags.test.sql`, `src/lib/flags/flags.test.ts`

**Interfaces:**
- Consumes: `Tenant['cohort']` (Task 3), `is_agency_admin()` (Task 2).
- Produces: tablas `feature_flags(key text pk, rollout text check in ('off','pilot','all') default 'off')` y `feature_flag_audit(id, key, previous text, next text, changed_by uuid, changed_at)`; `isFeatureEnabled(rollout: 'off'|'pilot'|'all', tenant: Pick<Tenant,'cohort'>): boolean`; `setRollout(key: string, next: 'off'|'pilot'|'all', session: Session, deps): Promise<void>` que exige rol `agency_admin` y escribe auditoría.

- [ ] **Step 1: Write the failing tests:** `'pilot'` es `true` solo para cohorte `pilot`; `'all'` es `true` para todos; `'off'` es `false` para todos; `setRollout` con sesión `business_owner` lanza `ForbiddenError`; un cambio de `pilot` a `off` (rollback) escribe una fila de auditoría con `previous='pilot'` y `next='off'`; pgTAP: un dueño no puede escribir en `feature_flags`.
- [ ] **Step 2: Run** `supabase test db` y `pnpm vitest run src/lib/flags`. Expected: FAIL.
- [ ] **Step 3: Implement** migración, funciones y la página de liberaciones con un selector off/pilot/all por flag.
- [ ] **Step 4: Run** ambos comandos. Expected: PASS.
- [ ] **Step 5: Commit** `feat: feature flags by cohort with audit`.

### Task 9: Configuración del bot versionada

**Files:**
- Create: `supabase/migrations/20261106000004_bot_config_versions.sql`, `src/lib/botconfig/versions.ts`
- Test: `supabase/tests/bot_config.test.sql`, `src/lib/botconfig/versions.test.ts`

**Interfaces:**
- Consumes: `tenants` (Task 2).
- Produces: tabla `bot_config_versions(id, tenant_id, version int, config jsonb, status check in ('draft','published','archived'), unique (tenant_id, version))` con índice único parcial: una sola fila `published` por tenant; `createDraft(tenantId: string, config: unknown): Promise<{ version: number }>`; `publish(tenantId: string, version: number): Promise<void>`; `rollback(tenantId: string): Promise<{ version: number } | null>` que vuelve a publicar la versión publicada anterior y devuelve `null` si no hay anterior.

- [ ] **Step 1: Write the failing tests:** pgTAP: publicar dos versiones del mismo tenant a la vez deja exactamente una `published` (el índice rechaza la segunda); Vitest: `createDraft` numera 1, 2, 3; `publish(2)` archiva la anterior publicada; `rollback` tras publicar 1 y luego 2 deja la 1 publicada; `rollback` con una sola versión devuelve `null` y no cambia nada.
- [ ] **Step 2: Run** `supabase test db` y `pnpm vitest run src/lib/botconfig`. Expected: FAIL.
- [ ] **Step 3: Implement** migración y funciones (publicación en una transacción que archiva la anterior y publica la nueva).
- [ ] **Step 4: Run** ambos comandos. Expected: PASS.
- [ ] **Step 5: Commit** `feat: versioned bot config with rollback`.

### Task 10: Semilla de Spezia, entornos y regla de migraciones

**Files:**
- Create: `scripts/seed-spezia.ts`, `scripts/check-migration-safety.ts`, `docs/environments.md`
- Modify: `.github/workflows/ci.yml` (agregar el job `migrations`)
- Test: `scripts/check-migration-safety.test.ts`

**Interfaces:**
- Produces: `checkMigrationSafety(sql: string): string[]` que devuelve la lista de violaciones; el script ejecuta esa función sobre cada archivo de `supabase/migrations/` y sale con código 1 si hay alguna.

- [ ] **Step 1: Write the failing tests:** `checkMigrationSafety('alter table t drop column c;')` devuelve una violación; lo mismo para `drop table`, `rename column` y `rename to`; `create table`, `add column` y `create index` devuelven `[]`.
- [ ] **Step 2: Run** `pnpm vitest run scripts`. Expected: FAIL.
- [ ] **Step 3: Implement** `checkMigrationSafety` y el script que lo aplica a las migraciones; agregar el job al CI.
- [ ] **Step 4: Implement** `seed-spezia.ts`: crea el tenant Spezia con cohorte `pilot`, moneda base `HNL`, extra `USD`, y el primer usuario administrador de la agencia; solo corre con `APP_ENV` `local` o `staging` y aborta en `production`.
- [ ] **Step 5: Documentar** en `docs/environments.md` los dos proyectos de Supabase (staging y producción), los dos entornos de Vercel y el wildcard `*.accionahn.com` (la configuración en Vercel y Supabase la hace el dueño; la guía lo explica paso a paso).
- [ ] **Step 6: Run** `pnpm vitest run` y `supabase db reset && pnpm tsx scripts/seed-spezia.ts`. Expected: PASS y el tenant `spezia` existe en la base local.
- [ ] **Step 7: Commit** `feat: spezia seed, environments doc and migration safety check`.
