-- Availability calendar and slot bookings.
-- A booking occupies prep + service (+ buffer) minutes on one resource. Two live bookings
-- (status <> 'released') can never overlap on the same resource: the exclusion constraint
-- guarantees it for every writer, including direct inserts and concurrent transactions.
-- Opening hours and closed dates are per resource or tenant-wide (resource_id null); a
-- resource with its own hours uses only those. Times are wall-clock in the store timezone
-- (store_settings.timezone); bookings are stored as UTC ranges.
-- Errors raised by book_slot (P0001, the message tells them apart): slot_taken,
-- daily_limit_reached, outside_hours, closed_date, too_soon, too_far, not_bookable.
-- 42501: product or resource of another tenant. 22023: bad input.

-- btree_gist gives uuid a gist operator class so the exclusion constraint can combine
-- resource equality with range overlap. It only adds operator classes (no data, no drop).
create extension if not exists btree_gist with schema extensions;

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  active boolean not null default true,
  -- created by book_slot for a tenant that defines no resources (one team)
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint resources_id_tenant_key unique (id, tenant_id)
);
create index resources_tenant_id_idx on public.resources(tenant_id);
create unique index resources_one_default_idx on public.resources(tenant_id) where is_default;

-- No rows for a resource means it offers every product.
create table public.resource_services (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid not null,
  product_id uuid not null,
  primary key (resource_id, product_id),
  constraint resource_services_resource_fk foreign key (resource_id, tenant_id)
    references public.resources (id, tenant_id) on delete cascade,
  constraint resource_services_product_fk foreign key (product_id, tenant_id)
    references public.products (id, tenant_id) on delete cascade
);
create index resource_services_tenant_id_idx on public.resource_services(tenant_id);
create index resource_services_product_id_idx on public.resource_services(product_id, tenant_id);

-- weekday: 0 = Sunday (same as date_rules and the pricing engine).
create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid,
  weekday integer not null check (weekday between 0 and 6),
  opens time not null,
  closes time not null,
  constraint working_hours_opens_before_closes check (opens < closes),
  constraint working_hours_resource_fk foreign key (resource_id, tenant_id)
    references public.resources (id, tenant_id) on delete cascade
);
create index working_hours_tenant_id_idx on public.working_hours(tenant_id, weekday);
create index working_hours_resource_id_idx on public.working_hours(resource_id, tenant_id) where resource_id is not null;

create table public.closed_dates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource_id uuid,
  day date not null,
  reason text,
  constraint closed_dates_resource_fk foreign key (resource_id, tenant_id)
    references public.resources (id, tenant_id) on delete cascade
);
create index closed_dates_tenant_id_idx on public.closed_dates(tenant_id, day);
create index closed_dates_resource_id_idx on public.closed_dates(resource_id, tenant_id) where resource_id is not null;

create table public.product_calendar (
  product_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prep_minutes integer not null default 0 check (prep_minutes >= 0),
  service_minutes integer not null check (service_minutes > 0),
  buffer_minutes integer not null default 0 check (buffer_minutes >= 0),
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  slot_step_minutes integer not null default 30 check (slot_step_minutes between 5 and 1440),
  min_notice_hours integer not null default 0 check (min_notice_hours >= 0),
  max_days_ahead integer not null default 180 check (max_days_ahead >= 0),
  constraint product_calendar_product_fk foreign key (product_id, tenant_id)
    references public.products (id, tenant_id) on delete cascade
);
create index product_calendar_tenant_id_idx on public.product_calendar(tenant_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  resource_id uuid not null,
  -- the orders table arrives in a later migration, so no FK yet; book_slot requires it
  order_id uuid,
  during tstzrange not null
    check (not isempty(during) and not lower_inf(during) and not upper_inf(during)),
  status text not null default 'held' check (status in ('held','confirmed','released')),
  created_at timestamptz not null default now(),
  -- no cascade: a product or resource with bookings is deactivated, not deleted
  constraint bookings_product_fk foreign key (product_id, tenant_id)
    references public.products (id, tenant_id),
  constraint bookings_resource_fk foreign key (resource_id, tenant_id)
    references public.resources (id, tenant_id),
  constraint bookings_no_overlap exclude using gist (resource_id with =, during with &&)
    where (status <> 'released')
);
create index bookings_tenant_id_idx on public.bookings(tenant_id);
create index bookings_product_id_idx on public.bookings(product_id, tenant_id);
create index bookings_resource_fk_idx on public.bookings(resource_id, tenant_id);
create index bookings_order_id_idx on public.bookings(order_id) where order_id is not null;

alter table public.resources enable row level security;
alter table public.resource_services enable row level security;
alter table public.working_hours enable row level security;
alter table public.closed_dates enable row level security;
alter table public.product_calendar enable row level security;
alter table public.bookings enable row level security;

revoke all on public.resources, public.resource_services, public.working_hours,
  public.closed_dates, public.product_calendar, public.bookings
  from anon, authenticated, service_role;

-- Owners manage their own tenant's calendar setup; the agency manages all of them.
create policy resources_select on public.resources for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy resources_insert on public.resources for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy resources_update on public.resources for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy resources_delete on public.resources for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy resource_services_select on public.resource_services for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy resource_services_insert on public.resource_services for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy resource_services_delete on public.resource_services for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy working_hours_select on public.working_hours for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy working_hours_insert on public.working_hours for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy working_hours_update on public.working_hours for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy working_hours_delete on public.working_hours for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy closed_dates_select on public.closed_dates for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy closed_dates_insert on public.closed_dates for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy closed_dates_update on public.closed_dates for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy closed_dates_delete on public.closed_dates for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy product_calendar_select on public.product_calendar for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_calendar_insert on public.product_calendar for insert to authenticated
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_calendar_update on public.product_calendar for update to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin())
  with check (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
create policy product_calendar_delete on public.product_calendar for delete to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

create policy bookings_select on public.bookings for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

-- authenticated: SELECT and DELETE at table level; INSERT and UPDATE by column so that
-- tenant_id and keys never change on UPDATE. Bookings are read-only: only book_slot,
-- release_booking and confirm_booking (service_role) write them.
grant select, delete on public.resources, public.resource_services, public.working_hours,
  public.closed_dates, public.product_calendar to authenticated;
grant select on public.bookings to authenticated;
grant insert (id, tenant_id, name, active) on public.resources to authenticated;
grant update (name, active) on public.resources to authenticated;
grant insert (tenant_id, resource_id, product_id) on public.resource_services to authenticated;
grant insert (id, tenant_id, resource_id, weekday, opens, closes) on public.working_hours to authenticated;
grant update (resource_id, weekday, opens, closes) on public.working_hours to authenticated;
grant insert (id, tenant_id, resource_id, day, reason) on public.closed_dates to authenticated;
grant update (resource_id, day, reason) on public.closed_dates to authenticated;
grant insert (product_id, tenant_id, prep_minutes, service_minutes, buffer_minutes, daily_limit,
  slot_step_minutes, min_notice_hours, max_days_ahead) on public.product_calendar to authenticated;
grant update (prep_minutes, service_minutes, buffer_minutes, daily_limit, slot_step_minutes,
  min_notice_hours, max_days_ahead) on public.product_calendar to authenticated;

-- anon: nothing.

-- service_role: reads everything the slot computation needs; writes only the default
-- resource and bookings (through the functions below), and may change nothing on a
-- booking but its status.
grant select on public.resources, public.resource_services, public.working_hours,
  public.closed_dates, public.product_calendar, public.bookings to service_role;
grant insert (tenant_id, name, is_default) on public.resources to service_role;
grant insert (tenant_id, product_id, resource_id, order_id, during, status) on public.bookings to service_role;
grant update (status) on public.bookings to service_role;

create function public.book_slot(p_tenant uuid, p_product uuid, p_resource uuid,
  p_start timestamptz, p_order uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  v_cal public.product_calendar%rowtype;
  v_tz text;
  v_work interval;
  v_during tstzrange;
  v_local timestamp;
  v_end_local timestamp;
  v_day date;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_count integer;
  v_candidates uuid[];
  v_open uuid[];
  v_fit uuid[];
  v_res uuid;
  v_id uuid;
begin
  if p_order is null or p_start is null then
    raise exception 'order id and start are required' using errcode = '22023';
  end if;

  select p.tenant_id into v_owner from public.products p where p.id = p_product;
  if not found or v_owner <> p_tenant then
    raise exception 'product belongs to another tenant' using errcode = '42501';
  end if;

  select * into v_cal from public.product_calendar pc
    where pc.product_id = p_product and pc.tenant_id = p_tenant;
  if not found then
    raise exception 'not_bookable' using errcode = 'P0001';
  end if;

  select s.timezone into v_tz from public.store_settings s where s.tenant_id = p_tenant;
  v_tz := coalesce(v_tz, 'America/Tegucigalpa');

  -- opening hours bound prep + service; the buffer only keeps the next booking away
  v_work := make_interval(mins => v_cal.prep_minutes + v_cal.service_minutes);
  v_during := tstzrange(p_start, p_start + v_work + make_interval(mins => v_cal.buffer_minutes), '[)');
  v_local := p_start at time zone v_tz;
  v_end_local := (p_start + v_work) at time zone v_tz;
  v_day := v_local::date;
  v_day_start := v_day::timestamp at time zone v_tz;
  v_day_end := (v_day + 1)::timestamp at time zone v_tz;

  if p_start < now() + make_interval(hours => v_cal.min_notice_hours) then
    raise exception 'too_soon' using errcode = 'P0001';
  end if;
  if v_day > (now() at time zone v_tz)::date + v_cal.max_days_ahead then
    raise exception 'too_far' using errcode = 'P0001';
  end if;

  if p_resource is not null then
    perform 1 from public.resources r where r.id = p_resource and r.tenant_id = p_tenant;
    if not found then
      raise exception 'resource belongs to another tenant' using errcode = '42501';
    end if;
    select array_agg(r.id) into v_candidates from public.resources r
      where r.id = p_resource and r.active
        and (not exists (select 1 from public.resource_services rs where rs.resource_id = r.id)
             or exists (select 1 from public.resource_services rs
                          where rs.resource_id = r.id and rs.product_id = p_product));
    if v_candidates is null then
      raise exception 'resource is inactive or does not offer this product' using errcode = '22023';
    end if;
  else
    -- a tenant that defines no resources works as one implicit team
    if not exists (select 1 from public.resources r where r.tenant_id = p_tenant) then
      insert into public.resources (tenant_id, name, is_default) values (p_tenant, 'default', true)
        on conflict (tenant_id) where is_default do nothing;
    end if;
    select array_agg(r.id order by r.id) into v_candidates from public.resources r
      where r.tenant_id = p_tenant and r.active
        and (not exists (select 1 from public.resource_services rs where rs.resource_id = r.id)
             or exists (select 1 from public.resource_services rs
                          where rs.resource_id = r.id and rs.product_id = p_product));
    if v_candidates is null then
      raise exception 'not_bookable' using errcode = 'P0001';
    end if;
  end if;

  if exists (select 1 from public.closed_dates d
               where d.tenant_id = p_tenant and d.resource_id is null and d.day = v_day) then
    raise exception 'closed_date' using errcode = 'P0001';
  end if;
  select array_agg(x order by x) into v_open from unnest(v_candidates) as x
    where not exists (select 1 from public.closed_dates d
                        where d.tenant_id = p_tenant and d.resource_id = x and d.day = v_day);
  if v_open is null then
    raise exception 'closed_date' using errcode = 'P0001';
  end if;

  select array_agg(x order by x) into v_fit from unnest(v_open) as x
    where exists (
      select 1 from public.working_hours h
        where h.tenant_id = p_tenant
          and h.weekday = extract(dow from v_day)::integer
          and (h.resource_id = x
               or (h.resource_id is null
                   and not exists (select 1 from public.working_hours h2 where h2.resource_id = x)))
          and v_local >= v_day + h.opens
          and v_end_local <= v_day + h.closes);
  if v_fit is null then
    raise exception 'outside_hours' using errcode = 'P0001';
  end if;

  -- daily_limit: serialize bookings of this product on this tenant-local day so the count
  -- cannot be raced; the lock is released at the end of the transaction.
  if v_cal.daily_limit is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(p_tenant::text || ':' || p_product::text || ':' || v_day::text, 0));
    select count(*) into v_count from public.bookings b
      where b.tenant_id = p_tenant and b.product_id = p_product and b.status <> 'released'
        and lower(b.during) >= v_day_start and lower(b.during) < v_day_end;
    if v_count >= v_cal.daily_limit then
      raise exception 'daily_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  -- free resources, fewest bookings that day first. A concurrent booking that wins the
  -- race shows up as an exclusion violation: try the next resource.
  for v_res in
    select x from unnest(v_fit) as x
      where not exists (select 1 from public.bookings b
                          where b.resource_id = x and b.status <> 'released' and b.during && v_during)
      order by (select count(*) from public.bookings b
                  where b.resource_id = x and b.status <> 'released'
                    and lower(b.during) >= v_day_start and lower(b.during) < v_day_end), x
  loop
    begin
      insert into public.bookings (tenant_id, product_id, resource_id, order_id, during, status)
        values (p_tenant, p_product, v_res, p_order, v_during, 'held')
        returning id into v_id;
      return v_id;
    exception when exclusion_violation then
      null;
    end;
  end loop;

  raise exception 'slot_taken' using errcode = 'P0001';
end;
$$;

-- Frees every live booking of the order (held or confirmed, so a cancelled order gives
-- its time back). Returns how many changed; repeating it returns 0.
create function public.release_booking(p_order uuid) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.bookings set status = 'released'
    where order_id = p_order and status <> 'released';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.confirm_booking(p_order uuid) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.bookings set status = 'confirmed'
    where order_id = p_order and status = 'held';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.book_slot(uuid, uuid, uuid, timestamptz, uuid),
  public.release_booking(uuid), public.confirm_booking(uuid) from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid, uuid, timestamptz, uuid),
  public.release_booking(uuid), public.confirm_booking(uuid) to service_role;
