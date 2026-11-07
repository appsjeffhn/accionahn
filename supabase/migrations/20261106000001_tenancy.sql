create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  cohort text not null default 'general' check (cohort in ('pilot','general')),
  default_locale text not null default 'es' check (default_locale in ('es','en')),
  base_currency text not null default 'HNL',
  enabled_currencies text[] not null default array['HNL'],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.tenant_domains (
  hostname text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('subdomain','custom'))
);
create index tenant_domains_tenant_id_idx on public.tenant_domains(tenant_id);

create table public.memberships (
  user_id uuid not null unique references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('owner','staff'))
);
create index memberships_tenant_id_idx on public.memberships(tenant_id);

create table public.agency_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- Helpers run as definer so policies on memberships/agency_admins do not recurse.
create function public.auth_tenant_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.tenant_id from public.memberships m where m.user_id = auth.uid()
$$;

create function public.is_agency_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.agency_admins a where a.user_id = auth.uid())
$$;

revoke all on function public.auth_tenant_id() from public, anon;
revoke all on function public.is_agency_admin() from public, anon;
grant execute on function public.auth_tenant_id() to authenticated, service_role;
grant execute on function public.is_agency_admin() to authenticated, service_role;

alter table public.tenants enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.memberships enable row level security;
alter table public.agency_admins enable row level security;

-- anon: no grants and no policies.
revoke all on public.tenants, public.tenant_domains, public.memberships, public.agency_admins from anon;

-- tenants
create policy tenants_select on public.tenants for select to authenticated
  using (id = public.auth_tenant_id() or public.is_agency_admin());
create policy tenants_insert on public.tenants for insert to authenticated
  with check (public.is_agency_admin());
create policy tenants_update on public.tenants for update to authenticated
  using (id = public.auth_tenant_id() or public.is_agency_admin())
  with check (id = public.auth_tenant_id() or public.is_agency_admin());
create policy tenants_delete on public.tenants for delete to authenticated
  using (public.is_agency_admin());

-- tenant_domains: owners read their own; only admins write
create policy tenant_domains_select on public.tenant_domains for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy tenant_domains_insert on public.tenant_domains for insert to authenticated
  with check (public.is_agency_admin());
create policy tenant_domains_update on public.tenant_domains for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy tenant_domains_delete on public.tenant_domains for delete to authenticated
  using (public.is_agency_admin());

-- memberships: users read their own row; only admins write
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_agency_admin());
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.is_agency_admin());
create policy memberships_update on public.memberships for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.is_agency_admin());

-- agency_admins: admins only
create policy agency_admins_select on public.agency_admins for select to authenticated
  using (public.is_agency_admin());
create policy agency_admins_insert on public.agency_admins for insert to authenticated
  with check (public.is_agency_admin());
create policy agency_admins_update on public.agency_admins for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy agency_admins_delete on public.agency_admins for delete to authenticated
  using (public.is_agency_admin());
