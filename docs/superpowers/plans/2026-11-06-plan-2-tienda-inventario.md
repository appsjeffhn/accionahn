# Plan 2: Tienda, inventario, calendario y pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un negocio configura su catálogo (simple, configurable, reservable), sus precios, calendario, envío y cobros desde un panel; el cliente final arma un pedido con precio real, reserva un horario libre, sube su comprobante de anticipo y el dueño lo revisa.

**Architecture:** Mismo app Next.js y mismo Supabase del Plan 1. Todo el cálculo de dinero vive en **un módulo TypeScript puro** (`src/lib/pricing`) que el servidor ejecuta al crear el pedido y que el bot reutilizará en el plan 3. Las reglas que no se pueden romper (sin cruces de horario, sin vender stock inexistente, estados de pedido válidos) las imponen **restricciones y funciones de Postgres**, probadas con pgTAP. La tienda lee y escribe con el cliente `service_role` del servidor, filtrando siempre por el tenant del host (sin permisos de `anon`); el panel del dueño usa su sesión con RLS.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres, RLS, Auth; `btree_gist` para exclusión de franjas), next-intl, zod, vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-11-06-plan-2-tienda-inventario-design.md` (extiende `2026-11-05-accionahn-bot-platform-design.md`, secciones 5.3 a 5.5 y 6.1). Este plan cubre el proyecto 2. Bot, WhatsApp, pagos en línea y cálculo de distancia con mapa **no** están aquí.

## Global Constraints

- Dinero siempre en **unidades menores enteras** (centavos; `CLP` y `PYG` con 0 decimales). Nunca `number` con decimales ni `float` en la base.
- Total = base + extras + recargo por fecha + recargo de envío, en la moneda de la tienda. Moneda base por tienda; otras monedas con precio fijo por producto o tipo de cambio que define el dueño (`rate` = unidades de la moneda base por 1 unidad de la extra, como en la semilla: USD `rate: 25` con base HNL). Sin tipo de cambio automático.
- Recargos por fecha: monto fijo o porcentaje; si coinciden varias reglas **se suman**. El porcentaje se calcula sobre base + extras de la línea y se redondea por regla (half-up).
- Rangos de personas: precio **por persona**; con más personas que el último rango el pedido queda **por cotizar**.
- Envío: tres modos por negocio (`zones` automático, `approval`, `fixed`/`none`). Con `approval` **no existe total final ni anticipo** hasta que el dueño fija el recargo.
- Cobro por negocio: anticipo (porcentaje o fijo por producto), pago completo adelantado o pago al recibir; el envío puede ir prepagado o al recibir. Anticipos de varias líneas se suman.
- Un pedido tiene **una fecha y franja** por defecto; `store_settings.per_line_date = true` permite fecha por línea reservable.
- Reserva y stock se apartan al crear el pedido y **se liberan** si el pedido se cancela o vence (24 h por defecto, ajustable) contado desde que existe un total final.
- Nadie, ni el bot, dice "pago recibido" hasta que el dueño marque el pedido como pagado.
- Español e inglés en tienda y panel; nombres y descripciones de producto como `jsonb {"es": "...", "en": "..."}` (el idioma faltante cae al otro).
- Tablas nuevas: `enable row level security`, `revoke all` a `anon, authenticated, service_role` y conceder solo lo usado (regla de `20261106000014`). Migraciones compatibles hacia atrás; `pnpm check:migrations` debe pasar. Numerar desde `20261106000015`.
- `anon` no recibe ningún permiso sobre tablas de la tienda; el cliente invitado solo entra por el servidor con un enlace secreto de un solo pedido.
- Supabase Storage no corre en el entorno local (se excluye en `supabase start`): el almacenamiento de archivos va detrás de la interfaz `FileStore` con un doble en memoria para pruebas; los buckets reales se verifican a mano en staging.

## Review Focus

1. Dos clientes piden la **misma franja** (o la última unidad de stock) a la vez: gana uno, el otro recibe error claro. (Tasks 3, 4, 5)
2. El cliente manda un total o un precio manipulado: se ignora; el servidor recalcula con la base de datos. (Tasks 5, 10)
3. Envío por aprobación o rango excedido: el pedido **no** muestra total final ni monto de anticipo hasta que el dueño actúe. (Tasks 1, 6)
4. Enlace secreto de otro pedido, vencido o inventado: no se lee ni se sube comprobante; un dueño nunca ve archivos de otro negocio. (Tasks 5, 6, 10)
5. Moneda sin decimales (CLP), tipo de cambio que redondea y porcentaje sobre extras: el centavo cuadra entre tienda, pedido y panel. (Task 1)

---

## File Structure

```
src/lib/pricing/{money.ts,types.ts,engine.ts}        # puro, sin I/O
src/lib/catalog/{schema.ts,catalog.ts,catalog.store.ts}
src/lib/stock/{stock.ts,stock.store.ts}
src/lib/calendar/{calendar.ts,calendar.store.ts}
src/lib/orders/{states.ts,orders.ts,orders.store.ts,operations.ts,expire.ts}
src/lib/storage/{file-store.ts,supabase-file-store.ts}
src/lib/auth/{login.ts,owner-invite.ts,panel-session.ts}
src/lib/store/{settings.ts,theme.ts}
src/app/login/  src/app/auth/callback/
src/app/(owner)/panel/...           # catálogo, calendario, pedidos, ajustes, apariencia
src/app/(store)/...                 # tienda: /, /p/[id], /cart, /checkout, /order/[token]
src/app/api/cron/expire-orders/route.ts
supabase/migrations/20261106000015..*.sql   supabase/tests/*.sql
```

---

### Task 1: Motor de precios (puro)

**Files:**
- Create: `src/lib/pricing/money.ts`, `src/lib/pricing/types.ts`, `src/lib/pricing/engine.ts`
- Test: `src/lib/pricing/money.test.ts`, `src/lib/pricing/engine.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_CURRENCIES` (`src/lib/agency/wizard-schema.ts`).
- Produces:
  - `money.ts`: `currencyExponent(code: string): number` (0 para `CLP`, `PYG`; 2 para el resto), `convertMinor(baseMinor: number, rate: number): number` (= `round(baseMinor / rate)`, half-up), `percentOf(minor: number, percent: number): number` (half-up), `formatMoney(minor: number, currency: string, locale: 'es'|'en'): string`.
  - `types.ts`: `PersonTier {minPeople, maxPeople, pricePerPersonMinor, includedMeats, includedToppings}`, `OptionDef {id, extraPriceMinor}`, `ConfigurableDef {tiers, meats: OptionDef[], toppings: OptionDef[]}`, `DateRule {id, kind: 'fixed'|'percent', value, weekdays?: number[], dates?: string[]}`, `ShippingConfig {mode: 'zones'|'approval'|'fixed'|'none', zones: {id, feeMinor}[], fixedFeeMinor: number, prepay: boolean}`, `Deposit {kind: 'none'|'percent'|'fixed'|'full', value: number}`, `PricedProduct {id, kind: 'simple'|'configurable', priceMinor, fixedPrices: Record<string, number>, configurable?: ConfigurableDef, deposit: Deposit}`, `CartLine {lineId, productId, variantId?, qty, people?, meats?: string[], toppings?: string[], date?: string}`, `QuoteInput {currency, baseCurrency, rates: Record<string, number>, products: PricedProduct[], lines: CartLine[], dateRules: DateRule[], shipping: ShippingConfig, zoneId?: string, orderDate?: string, shippingFeeMinor?: number}`, `Quote {status: 'final'|'pending_shipping'|'pending_quote', lines: {lineId, baseMinor, extrasMinor, dateMinor, totalMinor}[], shipping: {status: 'final'|'pending', minor: number}, subtotalMinor, totalMinor: number | null, depositDueMinor: number | null, dueOnDeliveryMinor: number | null, errors: {lineId?: string, code: string}[]}`.
  - `engine.ts`: `computeQuote(input: QuoteInput): Quote`.

- [ ] **Step 1: Write the failing tests** (`engine.test.ts`, usando los números de Spezia como ejemplo): taqueada 25 personas en un rango 20–30 a L 180 por persona = base 450000 centavos; 3 carnes y 8 complementos incluidos no suman extras; una carne extra de L 25 suma 2500; fecha en sábado con regla `percent 10` y regla `fixed 5000` por fiesta el mismo día suma ambas sobre base+extras; 35 personas con último rango 30 → `status: 'pending_quote'`, `totalMinor: null`; menos carnes que las incluidas → error `too_few_options`; carne desconocida → `unknown_option`; envío `approval` sin `shippingFeeMinor` → `pending_shipping`, `totalMinor: null`, `depositDueMinor: null`; con `shippingFeeMinor` pasa a `final`; envío `zones` con `zoneId` inválido → error `unknown_zone`; depósito `percent 30` de dos líneas se suma y el envío `prepay: true` entra al anticipo (si no, entra a `dueOnDeliveryMinor`); moneda USD con `rate: 25` convierte 450000 HNL a 18000; producto con `fixedPrices.USD` usa ese precio y no el tipo de cambio; CLP no genera decimales; `qty` 0 o negativo → error `invalid_qty`; `money.test.ts`: `percentOf(1005, 10)` es 101 (half-up) y `convertMinor` redondea half-up.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/pricing`. Expected: FAIL (módulos no existen).
- [ ] **Step 3: Implement** `money.ts`, `types.ts` y `computeQuote` como función pura que nunca lanza por datos del cliente: devuelve `errors` y `totalMinor: null` si hay alguno. Decisiones fijas: menos opciones que las incluidas es error; más, se cobra `extraPriceMinor` de cada opción sobrante (las incluidas son las primeras N de la selección); la regla de fecha busca por `weekdays` (0=domingo) o por `dates` ISO; el estado `pending_quote` tiene prioridad sobre `pending_shipping`.
- [ ] **Step 4: Run** `pnpm vitest run src/lib/pricing`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pricing): pure quote engine with tiers, date rules, shipping and deposits`.

### Task 2: Catálogo (esquema, validación y almacén)

**Files:**
- Create: `supabase/migrations/20261106000015_catalog.sql`, `src/lib/catalog/schema.ts`, `src/lib/catalog/catalog.ts`, `src/lib/catalog/catalog.store.ts`
- Test: `supabase/tests/rls_catalog.test.sql`, `src/lib/catalog/schema.test.ts`, `src/lib/catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `auth_tenant_id()`, `is_agency_admin()`, `tenants` (Plan 1); `ConfigurableDef`, `Deposit`, `DateRule`, `ShippingConfig` (Task 1).
- Produces: tablas `products(id, tenant_id, kind check in ('simple','configurable'), reservable bool, name jsonb, description jsonb, price_minor int check >= 0, fixed_prices jsonb, configurable jsonb null, deposit jsonb, images text[], active bool, created_at)`, `product_variants(id, tenant_id, product_id, label jsonb, sku text null, stock int null check >= 0, active bool)` (`stock null` = sin control de existencias), `date_rules(id, tenant_id, label jsonb, kind, value, weekdays int[], dates date[])`, `shipping_zones(id, tenant_id, label jsonb, fee_minor int, position int)`, `store_settings(tenant_id pk, shipping_mode, fixed_fee_minor, shipping_prepay bool, payment_instructions jsonb, hold_hours int default 24, per_line_date bool default false, timezone text default 'America/Tegucigalpa', theme jsonb)`; todas con RLS: el dueño CRUD de su tenant y la agencia de todos; `productInputSchema`/`configurableDefSchema` (zod) con claves de error `catalog.errors.*`; `listStoreCatalog(tenantId): Promise<{products, variants, dateRules, zones, settings}>`; `saveProduct(session, input)`, `saveSettings(session, input)`. Los almacenes usan el cliente `service_role` para la tienda y se prueban con dobles en memoria.

- [ ] **Step 1: Write the failing tests:** zod rechaza rangos de personas que se traslapan o con huecos, `minPeople > maxPeople`, precios negativos o no enteros, `kind: 'simple'` con `configurable` definido, carne duplicada, `deposit percent` fuera de 1–100; un `business_owner` de otro tenant recibe `ForbiddenError` al guardar; pgTAP: el dueño del tenant A no ve ni escribe filas del tenant B en las cinco tablas, `anon` no tiene ningún permiso, un dueño no cambia `tenant_id` de un producto.
- [ ] **Step 2: Run** `pnpm supabase test db` y `pnpm vitest run src/lib/catalog`. Expected: FAIL.
- [ ] **Step 3: Implement** migración (con `revoke all` + grants mínimos y policies como `tenants`) y los módulos. Los grants de columna de las tablas de dinero no permiten al dueño tocar `tenant_id`.
- [ ] **Step 4: Run** ambos comandos más `pnpm check:migrations`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): products, variants, rules and store settings with RLS`.

### Task 3: Existencias y reservas de stock

**Files:**
- Create: `supabase/migrations/20261106000016_stock_reservations.sql`, `src/lib/stock/stock.ts`, `src/lib/stock/stock.store.ts`
- Test: `supabase/tests/stock.test.sql`, `src/lib/stock/stock.test.ts`

**Interfaces:**
- Consumes: `product_variants` (Task 2).
- Produces: tabla `stock_reservations(id, tenant_id, variant_id, order_id uuid null, qty int check > 0, status check in ('held','committed','released'), created_at)`; funciones SQL `hold_stock(p_tenant uuid, p_variant uuid, p_qty int, p_order uuid) returns uuid` (hace `update ... set stock = stock - p_qty where stock >= p_qty` en una sola sentencia y lanza `insufficient_stock` (`P0001`) si no alcanza; con `stock null` no descuenta), `commit_stock(p_order uuid)`, `release_stock(p_order uuid)` (devuelve el stock solo de reservas `held`; idempotente); `holdStock(tenantId, variantId, qty, orderId)`, `releaseStock(orderId)` con `InsufficientStockError`.

- [ ] **Step 1: Write the failing tests:** pgTAP: con stock 1, dos `hold_stock` seguidos → el primero tiene éxito y el segundo lanza `insufficient_stock` y el stock queda en 0; `release_stock` dos veces devuelve el stock una sola vez; `commit_stock` luego `release_stock` no devuelve nada; variante con `stock null` nunca lanza ni cambia; reservar una variante de otro tenant lanza error. Vitest: `holdStock` traduce el error de Postgres a `InsufficientStockError`.
- [ ] **Step 2: Run** `pnpm supabase test db` y `pnpm vitest run src/lib/stock`. Expected: FAIL.
- [ ] **Step 3: Implement** migración (funciones `security invoker`, `search_path = ''`, grants explícitos a `service_role`) y envoltorios.
- [ ] **Step 4: Run** ambos comandos y `pnpm check:migrations`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(stock): atomic stock holds with release and commit`.

### Task 4: Calendario de disponibilidad y reservas de franja

**Files:**
- Create: `supabase/migrations/20261106000017_calendar.sql`, `src/lib/calendar/calendar.ts`, `src/lib/calendar/calendar.store.ts`
- Test: `supabase/tests/calendar.test.sql`, `src/lib/calendar/calendar.test.ts`

**Interfaces:**
- Consumes: `products`, `store_settings.timezone` (Task 2).
- Produces: extensión `btree_gist`; tablas `resources(id, tenant_id, name, active)`, `resource_services(resource_id, product_id)` (si no hay filas el recurso atiende todo), `working_hours(id, tenant_id, resource_id null, weekday int check 0..6, opens time, closes time)`, `closed_dates(tenant_id, resource_id null, day date, reason)`, `product_calendar(product_id pk, tenant_id, prep_minutes int, service_minutes int, buffer_minutes int default 0, daily_limit int null, slot_step_minutes int default 30, min_notice_hours int default 0, max_days_ahead int default 180)`, `bookings(id, tenant_id, product_id, resource_id uuid, order_id uuid null, during tstzrange, status check in ('held','confirmed','released'))` con **`exclude using gist (resource_id with =, during with &&) where (status <> 'released')`**; funciones `book_slot(p_tenant uuid, p_product uuid, p_resource uuid null, p_start timestamptz, p_order uuid) returns uuid` (si `p_resource` es null elige el recurso libre con menos reservas ese día; valida horario, fecha cerrada, `daily_limit` con `pg_advisory_xact_lock` por producto y día, anticipación; lanza `slot_taken`, `daily_limit_reached`, `outside_hours`, `closed_date`), `release_booking(p_order uuid)`, `confirm_booking(p_order uuid)`; TS: `listAvailableSlots(tenantId, productId, day: string, resourceId?: string): Promise<{start: string, resourceIds: string[]}[]>`, `SlotTakenError`, `DailyLimitError`.

- [ ] **Step 1: Write the failing tests:** pgTAP: dos `book_slot` en el mismo recurso con franjas que se traslapan → el segundo lanza `slot_taken` (y la exclusión rechaza un `insert` directo); franjas contiguas sin traslape pasan; `daily_limit = 2` rechaza la tercera; `release_booking` libera y permite reservar de nuevo; fuera de horario y fecha cerrada lanzan su error; "cualquiera disponible" asigna al recurso libre y lanza `slot_taken` si todos están ocupados; un recurso que no atiende ese servicio no se asigna. Vitest: `listAvailableSlots` para Spezia (preparación 60 + servicio 120, pasos de 30 min, horario 8:00–20:00) no ofrece un inicio que termine después de las 20:00 ni franjas ocupadas, y respeta la zona horaria de la tienda.
- [ ] **Step 2: Run** `pnpm supabase test db` y `pnpm vitest run src/lib/calendar`. Expected: FAIL.
- [ ] **Step 3: Implement** migración (RLS dueño/agencia, `revoke all` + grants mínimos, funciones con `search_path = ''`) y módulo TS; las franjas se calculan en la zona horaria de la tienda y se guardan en UTC.
- [ ] **Step 4: Run** ambos comandos y `pnpm check:migrations`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(calendar): availability, resources and non-overlapping bookings`.

### Task 5: Pedidos: esquema, estados y creación atómica

**Files:**
- Create: `supabase/migrations/20261106000018_orders.sql`, `src/lib/orders/states.ts`, `src/lib/orders/orders.ts`, `src/lib/orders/orders.store.ts`
- Test: `supabase/tests/orders.test.sql`, `src/lib/orders/states.test.ts`, `src/lib/orders/orders.test.ts`

**Interfaces:**
- Consumes: `computeQuote`, tipos (Task 1); `listStoreCatalog` (Task 2); `holdStock`, `InsufficientStockError` (Task 3); `book_slot`, `SlotTakenError` (Task 4).
- Produces: tablas `orders(id, tenant_id, public_token text unique, status, currency, customer_name, customer_phone, fields jsonb, shipping_zone_id, shipping_fee_minor int null, subtotal_minor, total_minor int null, deposit_due_minor int null, due_on_delivery_minor int null, hold_expires_at timestamptz null, created_at)`, `order_lines(id, order_id, tenant_id, product_id, variant_id, qty, snapshot jsonb, total_minor)`, `order_events(id, order_id, tenant_id, from_status, to_status, actor, reason, at)`; `states.ts`: `OrderStatus` = `'pending_shipping' | 'pending_quote' | 'awaiting_deposit' | 'awaiting_review' | 'confirmed' | 'cancelled'`, `canTransition(from, to): boolean` con la tabla de transiciones (p. ej. `pending_shipping → awaiting_deposit | cancelled`, `awaiting_deposit → awaiting_review | cancelled`, `awaiting_review → confirmed | awaiting_deposit | cancelled`, `confirmed → cancelled`; nada sale de `cancelled`) y trigger SQL que rechaza cualquier otra; `createOrder(tenant: Tenant, input: {lines: CartLine[], customer: {name, phone}, fields, zoneId?, start?: string, resourceId?: string}, deps): Promise<{orderId: string, publicToken: string, quote: Quote}>` que **ignora todo precio del cliente**: carga el catálogo, llama `computeQuote`, rechaza si hay `errors`, y en una sola función SQL `create_order(...)` (transacción) inserta pedido y líneas, aparta stock y franja y fija el estado y `hold_expires_at` (solo si ya hay total final); con `store_settings.per_line_date = true` cada línea reservable lleva su propio `start`/`resourceId` y reserva por separado (si no, todas comparten el `start` del pedido y el recargo de fecha y el envío se calculan una vez); límite de abuso: máximo 3 pedidos pendientes por teléfono y por tenant (`TooManyPendingOrdersError`).

- [ ] **Step 1: Write the failing tests:** pgTAP: transiciones inválidas rechazadas por trigger (p. ej. `confirmed → awaiting_deposit`, `cancelled → confirmed`); cada cambio de estado escribe `order_events`; `create_order` que falla por franja ocupada no deja stock apartado ni pedido (todo o nada); `public_token` único; `anon` y `authenticated` ajenos no leen pedidos. Vitest: `canTransition` recorre la tabla completa; `createOrder` con `total` falso del cliente produce el total del motor; envío `approval` crea el pedido en `pending_shipping` con `total_minor` y `deposit_due_minor` nulos y sin `hold_expires_at`; envío `zones` crea `awaiting_deposit` con vencimiento a `hold_hours`; stock agotado lanza `InsufficientStockError` y nada queda reservado; con `per_line_date` activo dos líneas reservables en franjas distintas crean dos reservas y si una falla no queda ninguna; cuarto pedido pendiente del mismo teléfono lanza `TooManyPendingOrdersError`; dos `createOrder` simultáneos por la misma franja: exactamente uno tiene éxito.
- [ ] **Step 2: Run** `pnpm supabase test db` y `pnpm vitest run src/lib/orders`. Expected: FAIL.
- [ ] **Step 3: Implement** migración (RLS dueño/agencia de lectura y cambios de estado solo por funciones; `anon` sin permisos; `revoke all` + grants mínimos) y módulos. `public_token` = 32 bytes aleatorios en base64url generados en el servidor.
- [ ] **Step 4: Run** ambos comandos y `pnpm check:migrations`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(orders): atomic order creation with stock, slot and state machine`.

### Task 6: Operaciones del dueño: envío, comprobantes, cancelar y vencer

**Files:**
- Create: `supabase/migrations/20261106000019_order_operations.sql`, `src/lib/orders/operations.ts`, `src/lib/orders/expire.ts`, `src/lib/storage/file-store.ts`, `src/lib/storage/supabase-file-store.ts`, `src/app/api/cron/expire-orders/route.ts`, `vercel.json`
- Modify: `src/lib/env.ts` (variable `CRON_SECRET`, opcional salvo en producción), `.env.example`
- Test: `supabase/tests/order_operations.test.sql`, `src/lib/orders/operations.test.ts`, `src/lib/orders/expire.test.ts`

**Interfaces:**
- Consumes: `canTransition` y almacén de pedidos (Task 5); `releaseStock`, `release_booking` (Tasks 3 y 4); `requireRole`, `Session` (Plan 1).
- Produces: `FileStore {put(path: string, bytes: Uint8Array, contentType: string): Promise<void>; signedUrl(path: string, seconds: number): Promise<string>}` con doble en memoria; `setShippingFee(session, orderId, feeMinor)` (solo `pending_shipping`/`pending_quote`; recalcula total, anticipo y `hold_expires_at`; pasa a `awaiting_deposit`); `setQuotedPrice(session, orderId, totalMinor)` para rango excedido; `submitProof(orderToken, file: {bytes, contentType}, deps)` (valida token, estado `awaiting_deposit`, tipo imagen/PDF y máximo 5 MB, guarda en `<tenant_id>/<order_id>/<uuid>` y pasa a `awaiting_review`); `approveProof(session, orderId)` (pasa a `confirmed`, `commit_stock`, `confirm_booking`); `rejectProof(session, orderId, reason)` (vuelve a `awaiting_deposit` con motivo); `cancelOrder(session, orderId, reason)` (libera stock y franja); `expireOrders(now: Date, deps): Promise<{expired: number}>` que cancela pedidos `awaiting_deposit` con `hold_expires_at < now` y libera todo; la ruta cron la llama con cabecera `Authorization: Bearer ${CRON_SECRET}`. Todas las operaciones del dueño verifican `session.tenantId === order.tenantId`.

- [ ] **Step 1: Write the failing tests:** dueño de otro tenant no puede operar el pedido (`ForbiddenError`); `setShippingFee` con pedido ya `awaiting_deposit` es rechazado; tras fijar el envío el total = subtotal + envío y el anticipo incluye el envío solo si `prepay`; `submitProof` con token de otro pedido, pedido vencido, archivo de 6 MB o tipo `text/html` es rechazado y no guarda nada; `approveProof` deja stock `committed` y franja `confirmed`; `rejectProof` guarda motivo en `order_events` y permite subir otro comprobante; `expireOrders` no toca pedidos `pending_shipping` ni `confirmed`, libera stock y franja de los vencidos y es idempotente; la ruta cron responde 401 sin el secreto correcto.
- [ ] **Step 2: Run** `pnpm supabase test db` y `pnpm vitest run src/lib/orders`. Expected: FAIL.
- [ ] **Step 3: Implement** funciones SQL de transición con reglas de estado y los módulos; `vercel.json` con cron cada 15 minutos hacia `/api/cron/expire-orders`.
- [ ] **Step 4: Run** ambos comandos y `pnpm check:migrations`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(orders): owner operations, proof review and expiry`.

### Task 7: Inicio de sesión, invitación del dueño y sesión del panel

**Files:**
- Create: `src/lib/auth/login.ts`, `src/lib/auth/owner-invite.ts`, `src/lib/auth/panel-session.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/(owner)/panel/layout.tsx`
- Modify: `src/app/(agency)/agency/tenants/[id]/wizard/page.tsx` (botón "Invitar al dueño"), `messages/es.json`, `messages/en.json`
- Test: `src/lib/auth/login.test.ts`, `src/lib/auth/owner-invite.test.ts`, `src/lib/auth/panel-session.test.ts`

**Interfaces:**
- Consumes: `deriveSession`, `Session`, `canAccess` (Plan 1); `@supabase/ssr` (Plan 1 `session.ts`).
- Produces: `loginWithPassword(email, password, deps): Promise<{ok: true} | {ok: false, error: 'invalid'}>` (mismo error para correo inexistente y contraseña errónea); `inviteOwner(session, tenantId, email, deps): Promise<void>` (solo `agency_admin`; crea o invita al usuario con `auth.admin.inviteUserByEmail` y crea la fila en `memberships` con rol `owner` si el usuario no tiene otra; un usuario con membresía en otro tenant → `AlreadyMemberError`); `requirePanelSession(host tenantId: string): Promise<Session>` que redirige a `/login` si no hay sesión y lanza 404 si el tenant de la sesión no es el del host (cierra el pendiente "requirePanelSession" del Plan 1); la página `/login` en hosts de tienda y de agencia con textos es/en.

- [ ] **Step 1: Write the failing tests:** credenciales inválidas devuelven el mismo error en ambos casos y no revelan si el correo existe; `inviteOwner` con sesión de dueño lanza `ForbiddenError`; invitar a un usuario que ya es dueño de otro tenant lanza `AlreadyMemberError` y no crea membresía; invitar dos veces al mismo correo en el mismo tenant no duplica; `requirePanelSession` con sesión de otro tenant lanza no-encontrado y sin sesión redirige a `/login?next=/panel`.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/auth`. Expected: FAIL.
- [ ] **Step 3: Implement** módulos, páginas y callback de invitación (el dueño fija su contraseña al aceptar). Validar `next` como ruta relativa propia para evitar redirecciones abiertas.
- [ ] **Step 4: Run** `pnpm vitest run src/lib/auth` y `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): login, owner invitation and panel session guard`.

### Task 8: Panel del dueño: catálogo, calendario y ajustes

**Files:**
- Create: `src/app/(owner)/panel/page.tsx`, `src/app/(owner)/panel/products/...`, `src/app/(owner)/panel/calendar/...`, `src/app/(owner)/panel/settings/...`, `src/lib/store/settings.ts`
- Modify: `messages/es.json`, `messages/en.json`
- Test: `src/lib/store/settings.test.ts`, `src/lib/catalog/form.test.ts`

**Interfaces:**
- Consumes: `saveProduct`, `saveSettings`, `listStoreCatalog` (Task 2); `requirePanelSession` (Task 7); `productInputSchema` (Task 2).
- Produces: `parseProductForm(formData: FormData): {ok: true, value: ProductInput} | {ok: false, errors: Record<string, string>}` (errores por campo con claves i18n, como `wizard-form.ts` del Plan 1); `parseSettingsForm(formData)`; páginas del panel para: lista y edición de productos de los tres tipos (con editor de rangos de personas, carnes, complementos y extras, variantes con existencias, depósito), reglas de fecha, zonas de envío, modo de envío, instrucciones de transferencia, recursos, horarios, fechas cerradas y límites por producto reservable.

- [ ] **Step 1: Write the failing tests:** `parseProductForm` convierte "180.00" en 18000 centavos según la moneda de la tienda y rechaza "18.005"; un rango con huecos devuelve error en el campo del rango; `parseSettingsForm` rechaza `hold_hours` fuera de 1–168 y zona horaria inexistente.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/store src/lib/catalog`. Expected: FAIL.
- [ ] **Step 3: Implement** parsers y páginas (Server Components + Server Actions; sin librerías de formularios nuevas). Todas las páginas llaman `requirePanelSession`.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm typecheck` y `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panel): catalog, calendar and store settings screens`.

### Task 9: Panel del dueño: pedidos y comprobantes

**Files:**
- Create: `src/app/(owner)/panel/orders/page.tsx`, `src/app/(owner)/panel/orders/[id]/page.tsx`, `src/lib/orders/orders-view.ts`
- Modify: `messages/es.json`, `messages/en.json`
- Test: `src/lib/orders/orders-view.test.ts`

**Interfaces:**
- Consumes: `setShippingFee`, `setQuotedPrice`, `approveProof`, `rejectProof`, `cancelOrder`, `FileStore.signedUrl` (Task 6); `requirePanelSession` (Task 7).
- Produces: `toOrderRow(order, locale): {id, statusLabelKey, customerName, whenLabel, totalLabel, actions: ('set_shipping'|'set_price'|'approve'|'reject'|'cancel')[]}` que decide qué acciones mostrar según el estado (`pending_shipping` → `set_shipping`; `awaiting_review` → `approve`, `reject`); lista filtrable por estado y detalle con desglose, comprobante (URL firmada de 5 minutos generada en el servidor) y acciones con motivo obligatorio para rechazar y cancelar.

- [ ] **Step 1: Write the failing tests:** `toOrderRow` ofrece solo las acciones válidas por estado (ninguna en `cancelled`; `approve` solo en `awaiting_review`); el total de un pedido sin total final se muestra como "por confirmar" y nunca como 0; el motivo vacío al rechazar o cancelar se rechaza.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/orders/orders-view`. Expected: FAIL.
- [ ] **Step 3: Implement** helper y páginas. La URL firmada se genera por petición, nunca se guarda.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm typecheck` y `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panel): order list, shipping and proof review screens`.

### Task 10: Tienda pública: catálogo, carrito, pedido y seguimiento

**Files:**
- Create: `src/app/(store)/page.tsx`, `src/app/(store)/p/[id]/page.tsx`, `src/app/(store)/cart/page.tsx`, `src/app/(store)/checkout/page.tsx`, `src/app/(store)/order/[token]/page.tsx`, `src/app/(store)/actions.ts`, `src/lib/cart/cart.ts`
- Modify: `src/app/page.tsx` (la raíz de un host de tienda muestra la tienda), `messages/es.json`, `messages/en.json`
- Test: `src/lib/cart/cart.test.ts`, `src/lib/orders/public-order.test.ts`

**Interfaces:**
- Consumes: `listStoreCatalog` (Task 2); `computeQuote` (Task 1); `listAvailableSlots` (Task 4); `createOrder`, `submitProof` (Tasks 5 y 6); tenant resuelto por `x-tenant-*` del middleware (Plan 1).
- Produces: `addToCart(cart: Cart, line: CartLine): Cart`, `removeFromCart`, `quoteForDisplay(cart, catalog, choices): Quote` (la misma función del motor, solo para mostrar); el carrito vive en una cookie con ids y selecciones, **nunca precios**; `getPublicOrder(token: string, tenantId: string): Promise<PublicOrder | null>` (devuelve `null` si el token no existe, es de otro tenant o el pedido está cancelado hace más de 30 días; nunca expone datos de otros pedidos); páginas: selector guiado de taqueada (personas, carnes, complementos, extras), selector de fecha y hora solo con franjas libres, selección de zona de envío cuando el modo es `zones`, desglose completo antes de confirmar ("envío por confirmar" cuando aplica), pantalla de pedido con estado, monto de anticipo, datos de transferencia y subida de comprobante.

- [ ] **Step 1: Write the failing tests:** la cookie del carrito rechaza un precio inyectado (se ignora); `getPublicOrder` con un token válido de otro tenant devuelve `null`; un token mal formado devuelve `null` sin consultar la base; `quoteForDisplay` da el mismo total que el motor para el mismo carrito (misma función); un producto inactivo o agotado en el carrito produce error y no se puede confirmar.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/cart src/lib/orders/public-order`. Expected: FAIL.
- [ ] **Step 3: Implement** carrito, acciones del servidor (con límite de pedidos de Task 5) y páginas, con textos es/en y el idioma del tenant por defecto. Los enlaces de pedido llevan `Referrer-Policy: no-referrer` y la página `noindex`.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm typecheck`, `pnpm lint` y `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): storefront, cart, checkout and order tracking`.

### Task 11: Apariencia por cliente

**Files:**
- Create: `src/lib/store/theme.ts`, `src/app/(owner)/panel/appearance/page.tsx`, `src/app/(store)/layout.tsx`
- Modify: `messages/es.json`, `messages/en.json`
- Test: `src/lib/store/theme.test.ts`

**Interfaces:**
- Consumes: `store_settings.theme` (Task 2); `FileStore` (Task 6).
- Produces: `themeSchema` (zod): `{primary, accent, background, text}` como colores `#rrggbb`, `font: 'sans'|'serif'|'rounded'`, `logoPath?: string`, `heading: {es, en}`, `tagline: {es, en}`; `themeToCssVars(theme): Record<string, string>`; `contrastRatio(fg, bg): number` y rechazo de combinaciones de texto/fondo con contraste menor a 4.5; la tienda aplica las variables CSS en el layout; el logo (PNG/JPG/SVG sanitizado como imagen, máximo 1 MB) se sube por `FileStore` a un bucket público `tenant-assets`.

- [ ] **Step 1: Write the failing tests:** un color que no es `#rrggbb` o un `font` fuera de la lista se rechaza; `contrastRatio('#000000', '#ffffff')` es 21; texto claro sobre fondo claro (ratio < 4.5) se rechaza con error en el campo; `themeToCssVars` no emite valores sin validar; un `logoPath` de otro tenant se rechaza.
- [ ] **Step 2: Run** `pnpm vitest run src/lib/store/theme`. Expected: FAIL.
- [ ] **Step 3: Implement** esquema, variables CSS, página de apariencia con vista previa y layout de la tienda.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm typecheck` y `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): per-tenant appearance with contrast check`.

### Task 12: Datos de Spezia y recorrido de punta a punta

**Files:**
- Modify: `scripts/seed-spezia.ts` (catálogo de Spezia), `docs/environments.md` (pasos de tienda: buckets, `CRON_SECRET`, datos de transferencia)
- Create: `scripts/seed-spezia-catalog.ts`, `scripts/seed-spezia-catalog.test.ts`
- Test: `scripts/seed-spezia-catalog.test.ts`

**Interfaces:**
- Consumes: todos los almacenes de las Tasks 2 a 5; guardas de `seed-guard.ts` (Plan 1).
- Produces: `SPEZIA_CATALOG` (datos puros: encurtidos como productos simples con variantes de frasco; taqueada configurable y reservable con rangos por persona, 3 carnes, 8 complementos, preparación 60 y servicio 120, depósito en porcentaje; zonas de envío de ejemplo; reglas de fecha de ejemplo; modo de envío `approval`) y `seedSpeziaCatalog(supabase)` idempotente con las mismas guardas de producción que el seed del Plan 1. **Los precios, rangos, zonas y datos de transferencia reales los aporta el dueño**; la semilla trae valores marcados `EJEMPLO` que no deben llegar a producción.

- [ ] **Step 1: Write the failing tests:** `SPEZIA_CATALOG` pasa `productInputSchema` y `configurableDefSchema`; cada precio de ejemplo lleva la marca `EJEMPLO`; `computeQuote` con un carrito de ejemplo (25 personas, sábado) da un total final conocido; `seedSpeziaCatalog` dos veces no duplica filas; en `APP_ENV=production` el seed se niega.
- [ ] **Step 2: Run** `pnpm vitest run scripts`. Expected: FAIL.
- [ ] **Step 3: Implement** datos y seed; documentar en `docs/environments.md` cómo crear los buckets `payment-proofs` (privado) y `tenant-assets` (público) y definir `CRON_SECRET`. Con Supabase local arriba, recorrer a mano el flujo completo (pedido con envío por aprobación → fijar envío → comprobante → aprobar) y anotar el resultado en el reporte.
- [ ] **Step 4: Run** `pnpm vitest run`, `pnpm supabase test db`, `pnpm check:migrations`, `pnpm typecheck`, `pnpm lint` y `pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(seed): Spezia catalog and end-to-end store walkthrough`.

---

## Deferred to later plans

- Bot, búsqueda híbrida, medición de IA y pruebas automáticas (plan 3); WhatsApp y avisos al dueño (plan 4); cobro recurrente y facturación (plan 5).
- Cálculo de distancia con mapa y pagos en línea o enlaces de pago.
- Reembolsos automáticos, edición de un pedido confirmado y notificaciones por correo al cliente final.
- Importación masiva de productos y fotos múltiples con recorte.
- Editor del tope de IA y de ajustes de agencia, caché del lookup de tenant, renombrar `middleware` a `proxy` (siguen pendientes del Plan 1).
