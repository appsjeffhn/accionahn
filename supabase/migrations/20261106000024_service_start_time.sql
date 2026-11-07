-- book_slot: the picked time is the start of service, when the team arrives (owner's
-- decision). Preparation happens before it, on site, so a booking picked at S now occupies
-- [S - prep, S + service + buffer) instead of [S, S + prep + service + buffer).
--   * opening hours (merged rows, as in 20261106000023) must contain [S - prep, S + service]:
--     preparation is done on site inside working hours; the buffer may still run past
--     closing, as before.
--   * too_soon: S - prep (when the team must start preparing) against min_notice_hours.
--   * too_far and the daily limit: the local day of S. The occupied range lies inside that
--     day's hours, so lower(during) stays on the same local day and the daily count by
--     lower(during) is unchanged.
-- create_order passes the picked start unchanged; release/confirm/expire work by order id
-- and the gist indexes work on during, so none of them change.
--
-- Backward compatible: same signature, same security invoker mode, empty search_path,
-- same errors and lock order. Existing bookings keep their stored range (no data rewrite).
-- Grants are restated at the end.

create or replace function public.book_slot(p_tenant uuid, p_product uuid, p_resource uuid,
  p_start timestamptz, p_order uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  v_cal public.product_calendar%rowtype;
  v_tz text;
  v_prep_start timestamptz;
  v_service_end timestamptz;
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

  -- p_start is the start of service; preparation runs before it. Opening hours bound
  -- prep + service; the buffer only keeps the next booking away.
  v_prep_start := p_start - make_interval(mins => v_cal.prep_minutes);
  v_service_end := p_start + make_interval(mins => v_cal.service_minutes);
  v_during := tstzrange(v_prep_start, v_service_end + make_interval(mins => v_cal.buffer_minutes), '[)');
  v_local := v_prep_start at time zone v_tz;
  v_end_local := v_service_end at time zone v_tz;
  -- the day of the picked service start (limits, closed dates, hours, max_days_ahead)
  v_day := (p_start at time zone v_tz)::date;
  v_day_start := v_day::timestamp at time zone v_tz;
  v_day_end := (v_day + 1)::timestamp at time zone v_tz;

  if v_prep_start < now() + make_interval(hours => v_cal.min_notice_hours) then
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

  -- The resource's rows of that weekday (its own, else the tenant's), as one multirange:
  -- closed ranges, so rows that touch (..08:00] [08:00..) merge into one window. The
  -- booking [start of prep, end of service] must lie inside it.
  select array_agg(x order by x) into v_fit from unnest(v_open) as x
    where (
      select range_agg(tsrange(v_day + h.opens, v_day + h.closes, '[]'))
        from public.working_hours h
        where h.tenant_id = p_tenant
          and h.weekday = extract(dow from v_day)::integer
          and (h.resource_id = x
               or (h.resource_id is null
                   and not exists (select 1 from public.working_hours h2 where h2.resource_id = x)))
    ) @> tsrange(v_local, v_end_local, '[]');
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

revoke all on function public.book_slot(uuid, uuid, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid, uuid, timestamptz, uuid) to service_role;
