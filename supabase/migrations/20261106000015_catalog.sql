-- Store catalog: products, variants, date rules, shipping zones and store settings.
-- Money is integer minor units. Shipping fees (zones and fixed fee) are stored in the
-- tenant BASE currency. Names and descriptions are jsonb {"es","en"}.
-- Privilege model (same as 20261106000014): each table starts from nothing; anon gets
-- nothing; owners get CRUD limited by RLS, with column grants that never include
-- tenant_id on UPDATE; service_role gets what the store reads and writes.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('simple','configurable')),
  reservable boolean not null default false,
  name jsonb not null check (jsonb_typeof(name) = 'object'),
  description jsonb not null default '{"es":"","en":""}'::jsonb check (jsonb_typeof(description) = 'object'),
  price_minor integer not null default 0 check (price_minor >= 0),
  fixed_prices jsonb not null default '{}'::jsonb check (jsonb_typeof(fixed_prices) = 'object'),
  configurable jsonb check (configurable is null or jsonb_typeof(configurable) = 'object'),
  deposit jsonb not null default '{"kind":"none","value":0}'::jsonb check (jsonb_typeof(deposit) = 'object'),
  images text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint products_simple_has_no_configurable check (kind = 'configurable' or configurable is null),
  constraint products_id_tenant_key unique (id, tenant_id)
);
create index products_tenant_id_idx on public.products(tenant_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  label jsonb not null check (jsonb_typeof(label) = 'object'),
  sku text,
  -- null means stock is not tracked
  stock integer check (stock is null or stock >= 0),
  active boolean not null default true,
  constraint product_variants_product_fk foreign key (product_id, tenant_id)
    references public.products (id, tenant_id) on delete cascade
);
create index product_variants_tenant_id_idx on public.product_variants(tenant_id);
create index product_variants_product_id_idx on public.product_variants(product_id, tenant_id);

create table public.date_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label jsonb not null check (jsonb_typeof(label) = 'object'),
  kind text not null check (kind in ('fixed','percent')),
  -- fixed: minor units of the base currency; percent: 0 or more
  value numeric not null check (value >= 0),
  weekdays integer[] not null default '{}' check (weekdays <@ array[0,1,2,3,4,5,6]),
  dates date[] not null default '{}',
  constraint date_rules_matches_something check (cardinality(weekdays) + cardinality(dates) > 0)
);
create index date_rules_tenant_id_idx on public.date_rules(tenant_id);

create table public.shipping_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label jsonb not null check (jsonb_typeof(label) = 'object'),
  fee_minor integer not null check (fee_minor >= 0),
  position integer not null default 0
);
create index shipping_zones_tenant_id_idx on public.shipping_zones(tenant_id);

create table public.store_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  shipping_mode text not null default 'none' check (shipping_mode in ('zones','approval','fixed','none')),
  fixed_fee_minor integer not null default 0 check (fixed_fee_minor >= 0),
  shipping_prepay boolean not null default false,
  payment_instructions jsonb not null default '{"es":"","en":""}'::jsonb
    check (jsonb_typeof(payment_instructions) = 'object'),
  hold_hours integer not null default 24 check (hold_hours between 1 and 168),
  per_line_date boolean not null default false,
  timezone text not null default 'America/Tegucigalpa',
  theme jsonb not null default '{}'::jsonb check (jsonb_typeof(theme) = 'object')
);

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.date_rules enable row level security;
alter table public.shipping_zones enable row level security;
alter table public.store_settings enable row level security;

revoke all on public.products, public.product_variants, public.date_rules,
  public.shipping_zones, public.store_settings
  from anon, authenticated, service_role;

-- Policies: the owner reads and writes rows of their own tenant, the agency all of them.
create policy products_select on public.products for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy products_insert on public.products for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy products_update on public.products for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy products_delete on public.products for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy product_variants_select on public.product_variants for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_variants_insert on public.product_variants for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_variants_update on public.product_variants for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_variants_delete on public.product_variants for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy date_rules_select on public.date_rules for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy date_rules_insert on public.date_rules for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy date_rules_update on public.date_rules for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy date_rules_delete on public.date_rules for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy shipping_zones_select on public.shipping_zones for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy shipping_zones_insert on public.shipping_zones for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy shipping_zones_update on public.shipping_zones for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy shipping_zones_delete on public.shipping_zones for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy store_settings_select on public.store_settings for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy store_settings_insert on public.store_settings for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy store_settings_update on public.store_settings for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy store_settings_delete on public.store_settings for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

-- authenticated: SELECT and DELETE at table level; INSERT and UPDATE by column so that
-- tenant_id (and ids, product_id, created_at) can never be changed by an UPDATE.
grant select, delete on public.products, public.product_variants, public.date_rules,
  public.shipping_zones, public.store_settings to authenticated;
grant insert (id, tenant_id, kind, reservable, name, description, price_minor, fixed_prices,
  configurable, deposit, images, active) on public.products to authenticated;
grant update (kind, reservable, name, description, price_minor, fixed_prices,
  configurable, deposit, images, active) on public.products to authenticated;
grant insert (id, tenant_id, product_id, label, sku, stock, active) on public.product_variants to authenticated;
grant update (label, sku, stock, active) on public.product_variants to authenticated;
grant insert (id, tenant_id, label, kind, value, weekdays, dates) on public.date_rules to authenticated;
grant update (label, kind, value, weekdays, dates) on public.date_rules to authenticated;
grant insert (id, tenant_id, label, fee_minor, position) on public.shipping_zones to authenticated;
grant update (label, fee_minor, position) on public.shipping_zones to authenticated;
grant insert (tenant_id, shipping_mode, fixed_fee_minor, shipping_prepay, payment_instructions,
  hold_hours, per_line_date, timezone, theme) on public.store_settings to authenticated;
grant update (shipping_mode, fixed_fee_minor, shipping_prepay, payment_instructions,
  hold_hours, per_line_date, timezone, theme) on public.store_settings to authenticated;

-- anon: nothing on the store tables.

-- service_role: the store module saves products, variants and settings and reads the
-- rest. Deletes are not used (variants are deactivated, not removed).
grant select, insert, update on public.products, public.product_variants,
  public.store_settings to service_role;
grant select on public.date_rules, public.shipping_zones to service_role;
