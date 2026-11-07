-- Public signup requests. Anyone may submit one (insert-only, always pending and
-- unlinked); only agency admins can read, review or delete them.
create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(btrim(business_name)) between 1 and 200),
  contact_email text not null check (
    char_length(contact_email) <= 254
    and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  country text not null check (char_length(btrim(country)) between 1 and 100),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_requests_status_idx on public.client_requests(status, created_at);

alter table public.client_requests enable row level security;

revoke all on public.client_requests from anon, authenticated;
grant insert on public.client_requests to anon, authenticated;
grant select, update, delete on public.client_requests to authenticated;

create policy client_requests_insert on public.client_requests for insert to anon, authenticated
  with check (status = 'pending' and tenant_id is null);
create policy client_requests_select on public.client_requests for select to authenticated
  using (public.is_agency_admin());
create policy client_requests_update on public.client_requests for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy client_requests_delete on public.client_requests for delete to authenticated
  using (public.is_agency_admin());
