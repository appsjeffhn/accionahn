-- Fixes from the final review of the store (Plan 2). Backward compatible: functions keep
-- their signatures, security mode and empty search_path; their grants are restated at
-- the end. New checks are added NOT VALID and then validated.
--
--   release_stock / expire_orders: product variants are locked in id order, in one
--     statement, before any stock goes back (same order as create_order and
--     cancel_order), so an expiry sweep cannot deadlock with a checkout or a cancel.
--   cancel_order: its variant lock is FOR NO KEY UPDATE, like everywhere else.
--   missing_rate (P0001): an order in a currency other than the base one cannot be
--     priced without its exchange rate (set_shipping_fee, set_quoted_price,
--     order_reprice), and create_order refuses such a pending order.
--   multiple_unpriced_lines (P0001): set_quoted_price refuses an order with several
--     unpriced lines (was 22023) so the app can tell the owner why.
--   create_order: a product that has variants needs one, whether or not they are
--     active, so a product whose variants are all inactive cannot be ordered.
--   store_settings: service_role may update every column except tenant_id.
--   product_variants: owners can no longer write stock directly (adjust_stock only).
--   orders: awaiting_deposit always has a payment deadline.
--   bookings: gist index for slot listing (live bookings of a tenant by time).
--   date_rules: a fixed surcharge is a whole number of minor units.

-- ---------------------------------------------------------------- privileges
revoke update on public.store_settings from service_role;
grant update (shipping_mode, fixed_fee_minor, shipping_prepay, payment_instructions,
  hold_hours, per_line_date, timezone, theme) on public.store_settings to service_role;

revoke update (stock) on public.product_variants from authenticated;

-- ---------------------------------------------------------------- checks and index
alter table public.orders
  add constraint orders_deposit_has_deadline
  check (status <> 'awaiting_deposit' or hold_expires_at is not null) not valid;
alter table public.orders validate constraint orders_deposit_has_deadline;

alter table public.date_rules
  add constraint date_rules_fixed_is_integer
  check (kind = 'percent' or value = trunc(value)) not valid;
alter table public.date_rules validate constraint date_rules_fixed_is_integer;

create index bookings_tenant_during_live_idx on public.bookings
  using gist (tenant_id, during) where status <> 'released';

-- ---------------------------------------------------------------- stock release
create or replace function public.release_stock(p_order uuid) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  -- variants first, in id order and in one statement (same order as create_order)
  perform 1 from (
    select pv.id from public.product_variants pv
      where pv.id in (select s.variant_id from public.stock_reservations s
                        where s.order_id = p_order and s.status = 'held')
      order by pv.id for no key update) x;

  with rel as (
    update public.stock_reservations set status = 'released'
      where order_id = p_order and status = 'held'
      returning tenant_id, variant_id, qty
  ), back as (
    update public.product_variants pv set stock = pv.stock + s.q
      from (select tenant_id, variant_id, sum(qty) as q from rel group by tenant_id, variant_id) s
      where pv.id = s.variant_id and pv.tenant_id = s.tenant_id and pv.stock is not null
      returning 1
  )
  select count(*) into v_count from rel;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- pricing
-- Raises missing_rate for an order whose currency differs from the base one and has no
-- exchange rate: order_to_currency would otherwise keep the base amount unconverted.
create or replace function public.order_reprice(p_order uuid) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  r public.orders;
  v_subtotal integer;
  v_fee integer;
  v_deposit integer;
  v_status text;
  v_hold integer;
begin
  select * into r from public.orders o where o.id = p_order;
  if r.currency <> r.base_currency and r.exchange_rate is null then
    raise exception 'missing_rate' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.order_lines l
               where l.order_id = p_order and l.tenant_id = r.tenant_id
                 and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false)) then
    return r.status;
  end if;

  select coalesce(sum(l.total_minor), 0)::integer into v_subtotal
    from public.order_lines l where l.order_id = p_order and l.tenant_id = r.tenant_id;

  if r.shipping_fee_minor is null then
    update public.orders set status = 'pending_shipping', subtotal_minor = v_subtotal where id = p_order;
    return 'pending_shipping';
  end if;

  update public.order_lines l
    set snapshot = l.snapshot || jsonb_build_object('depositMinor', public.order_line_deposit(l.total_minor, l.snapshot))
    where l.order_id = p_order and l.tenant_id = r.tenant_id;

  v_fee := public.order_to_currency(r.shipping_fee_minor, r.exchange_rate);
  select coalesce(sum(public.order_line_deposit(l.total_minor, l.snapshot)), 0)::integer into v_deposit
    from public.order_lines l where l.order_id = p_order and l.tenant_id = r.tenant_id;
  if r.shipping_prepay then
    v_deposit := v_deposit + v_fee;
  end if;

  v_status := case when v_deposit > 0 then 'awaiting_deposit' else 'awaiting_review' end;
  select s.hold_hours into v_hold from public.store_settings s where s.tenant_id = r.tenant_id;

  update public.orders set
    status = v_status,
    subtotal_minor = v_subtotal,
    total_minor = v_subtotal + v_fee,
    deposit_due_minor = v_deposit,
    due_on_delivery_minor = v_subtotal + v_fee - v_deposit,
    hold_expires_at = case when v_status = 'awaiting_deposit'
                        then now() + make_interval(hours => coalesce(v_hold, 24)) end
  where id = p_order;
  return v_status;
end;
$$;

create or replace function public.set_shipping_fee(p_tenant uuid, p_order uuid, p_fee_minor integer, p_actor text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
begin
  if p_fee_minor is null or p_fee_minor < 0 then
    raise exception 'fee must be a non-negative integer' using errcode = '22023';
  end if;
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status not in ('pending_shipping', 'pending_quote') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if r.currency <> r.base_currency and r.exchange_rate is null then
    raise exception 'missing_rate' using errcode = 'P0001';
  end if;
  update public.orders set shipping_fee_minor = p_fee_minor where id = p_order;
  return public.order_reprice(p_order);
end;
$$;

create or replace function public.set_quoted_price(p_tenant uuid, p_order uuid, p_price_minor integer, p_actor text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_first uuid;
  v_unpriced integer;
  v_total integer;
begin
  if p_price_minor is null or p_price_minor < 0 then
    raise exception 'price must be a non-negative integer' using errcode = '22023';
  end if;
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status <> 'pending_quote' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if r.currency <> r.base_currency and r.exchange_rate is null then
    raise exception 'missing_rate' using errcode = 'P0001';
  end if;
  select count(*) into v_unpriced from public.order_lines l
    where l.order_id = p_order and l.tenant_id = r.tenant_id
      and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false);
  if v_unpriced = 0 then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  -- one price cannot be split over several unpriced lines (no per-line quoting yet)
  if v_unpriced > 1 then
    raise exception 'multiple_unpriced_lines' using errcode = 'P0001';
  end if;
  select l.id into v_first from public.order_lines l
    where l.order_id = p_order and l.tenant_id = r.tenant_id
      and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false);

  v_total := public.order_to_currency(p_price_minor, r.exchange_rate);
  update public.order_lines l set
    total_minor = v_total,
    snapshot = l.snapshot || jsonb_build_object(
      'pendingQuote', false, 'totalMinor', v_total, 'baseMinor', v_total,
      'extrasMinor', 0, 'dateMinor', 0, 'quotedBaseMinor', p_price_minor)
    where l.id = v_first;
  return public.order_reprice(p_order);
end;
$$;

-- ---------------------------------------------------------------- cancel
create or replace function public.cancel_order(p_tenant uuid, p_order uuid, p_reason text, p_actor text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if length(v_reason) = 0 or length(v_reason) > 1000 then
    raise exception 'a reason of 1 to 1000 characters is required' using errcode = '22023';
  end if;
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status = 'cancelled' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  perform set_config('app.order_reason', v_reason, true);
  update public.orders set status = 'cancelled' where id = p_order;

  -- variants in id order before the release update (same order as create_order)
  perform 1 from (
    select pv.id from public.product_variants pv
      where pv.tenant_id = p_tenant
        and pv.id in (select s.variant_id from public.stock_reservations s
                        where s.order_id = p_order and s.tenant_id = p_tenant
                          and s.status in ('held', 'committed'))
      order by pv.id for no key update) x;

  -- a confirmed order that is called off gives its committed units back too
  with rel as (
    update public.stock_reservations set status = 'released'
      where order_id = p_order and tenant_id = p_tenant and status in ('held', 'committed')
      returning tenant_id, variant_id, qty
  )
  update public.product_variants pv set stock = pv.stock + s.q
    from (select tenant_id, variant_id, sum(qty)::integer as q from rel group by tenant_id, variant_id) s
    where pv.id = s.variant_id and pv.tenant_id = s.tenant_id and pv.stock is not null;
  perform public.release_booking(p_order);
end;
$$;

-- ---------------------------------------------------------------- expiry
-- Same selection as 20261106000020. The orders are locked first (skipping rows held by a
-- running owner operation), then every variant they hold, in id order and in one
-- statement, and only then is anything released.
create or replace function public.expire_orders(p_now timestamptz, p_stale_days integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cut timestamptz;
  v_ids uuid[];
  v_reasons text[];
  i integer;
begin
  if p_now is null or p_stale_days is null or p_stale_days < 1 then
    raise exception 'now and a positive stale period are required' using errcode = '22023';
  end if;
  v_cut := p_now - make_interval(days => p_stale_days);

  select coalesce(array_agg(c.id order by c.id), '{}'), coalesce(array_agg(c.reason order by c.id), '{}')
    into v_ids, v_reasons
    from (
      select o.id,
             case when o.status = 'awaiting_deposit' then 'hold_expired'
                  when o.status = 'awaiting_review' then 'pay_on_delivery_unconfirmed'
                  else 'stale_pending' end as reason
        from public.orders o
        where (o.status = 'awaiting_deposit' and o.hold_expires_at < p_now)
           or (o.status in ('pending_shipping', 'pending_quote') and o.created_at < v_cut
               and (select max(e.at) from public.order_events e
                      where e.order_id = o.id and e.tenant_id = o.tenant_id) < v_cut)
           or (o.status = 'awaiting_review' and o.deposit_due_minor = 0 and o.hold_expires_at is null
               and o.created_at < v_cut
               and not exists (select 1 from public.order_events e
                                 where e.order_id = o.id and e.tenant_id = o.tenant_id and e.actor like 'owner:%'))
        order by o.id
        for update of o skip locked
    ) c;

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  perform 1 from (
    select pv.id from public.product_variants pv
      where pv.id in (select s.variant_id from public.stock_reservations s
                        where s.order_id = any (v_ids) and s.status = 'held')
      order by pv.id for no key update) x;

  for i in 1 .. cardinality(v_ids) loop
    perform set_config('app.order_actor', 'system', true);
    perform set_config('app.order_reason', v_reasons[i], true);
    update public.orders set status = 'cancelled' where id = v_ids[i];
    perform public.release_stock(v_ids[i]);
    perform public.release_booking(v_ids[i]);
  end loop;
  return cardinality(v_ids);
end;
$$;

-- ---------------------------------------------------------------- create_order
-- As 20261106000019, plus: missing_rate for a pending order in a non-base currency
-- without a rate, and variant_required for any product that has variants (active or
-- not), so a product whose variants are all inactive is not orderable.
create or replace function public.create_order(p_tenant uuid, p_order jsonb, p_lines jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_status text := p_order ->> 'status';
  v_phone text := p_order ->> 'customer_phone';
  v_hold integer;
  v_pending integer;
  v_id uuid;
  l record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'an order needs lines' using errcode = '22023';
  end if;
  if v_status is null
     or v_status not in ('pending_shipping','pending_quote','awaiting_deposit','awaiting_review') then
    raise exception 'invalid initial status' using errcode = '22023';
  end if;
  -- the owner prices pending orders in base currency later; that needs the rate
  if v_status in ('pending_shipping', 'pending_quote')
     and (p_order ->> 'currency') is distinct from (p_order ->> 'base_currency')
     and (p_order ->> 'exchange_rate') is null then
    raise exception 'missing_rate' using errcode = 'P0001';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant and t.status = 'active';
  if not found then
    raise exception 'tenant is not active' using errcode = '42501';
  end if;

  -- abuse limit: serialize orders of one phone in one tenant so the count cannot be raced
  perform pg_advisory_xact_lock(
    hashtextextended('orders:phone:' || p_tenant::text || ':' || coalesce(v_phone, ''), 0));
  select count(*) into v_pending from public.orders o
    where o.tenant_id = p_tenant and o.customer_phone = v_phone
      and o.status in ('pending_shipping','pending_quote','awaiting_deposit','awaiting_review');
  if v_pending >= 3 then
    raise exception 'too_many_pending_orders' using errcode = 'P0001';
  end if;

  -- products: locked against changes until commit, then checked (active, same tenant)
  perform 1 from (
    select p.id from public.products p
      where p.tenant_id = p_tenant
        and p.id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_lines) e)
      order by p.id for share) s;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
      where not exists (select 1 from public.products p
                          where p.id = (e ->> 'product_id')::uuid and p.tenant_id = p_tenant and p.active)) then
    raise exception 'product_unavailable' using errcode = 'P0001';
  end if;

  -- variants: locked in id order (hold_stock updates them), then checked
  perform 1 from (
    select v.id from public.product_variants v
      where v.tenant_id = p_tenant
        and v.id in (select (e ->> 'variant_id')::uuid from jsonb_array_elements(p_lines) e)
      order by v.id for no key update) s;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
      where e ->> 'variant_id' is not null
        and not exists (select 1 from public.product_variants v
                          where v.id = (e ->> 'variant_id')::uuid and v.tenant_id = p_tenant
                            and v.product_id = (e ->> 'product_id')::uuid and v.active)) then
    raise exception 'product_unavailable' using errcode = 'P0001';
  end if;
  -- any variant, active or not: a product with variants is sold only through one
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
      where e ->> 'variant_id' is null
        and exists (select 1 from public.product_variants v
                      where v.product_id = (e ->> 'product_id')::uuid and v.tenant_id = p_tenant)) then
    raise exception 'variant_required' using errcode = 'P0001';
  end if;

  -- reservable lines need a start; other lines take none
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
      join public.products p on p.id = (e ->> 'product_id')::uuid
      where p.reservable and e ->> 'start' is null) then
    raise exception 'start_required' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) e
      join public.products p on p.id = (e ->> 'product_id')::uuid
      where not p.reservable and (e ->> 'start' is not null or e ->> 'resource_id' is not null)) then
    raise exception 'only reservable lines take a start or resource' using errcode = '22023';
  end if;

  select s.hold_hours into v_hold from public.store_settings s where s.tenant_id = p_tenant;

  perform set_config('app.order_actor', 'customer', true);
  perform set_config('app.order_reason', '', true);
  insert into public.orders (tenant_id, public_token, status, currency, base_currency, exchange_rate,
    customer_name, customer_phone, fields, shipping_zone_id, shipping_prepay, shipping_fee_minor,
    subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor, hold_expires_at)
  values (p_tenant, p_order ->> 'public_token', v_status, p_order ->> 'currency',
    p_order ->> 'base_currency', (p_order ->> 'exchange_rate')::numeric, p_order ->> 'customer_name',
    v_phone, coalesce(p_order -> 'fields', '{}'::jsonb), (p_order ->> 'shipping_zone_id')::uuid,
    coalesce((p_order ->> 'shipping_prepay')::boolean, false), (p_order ->> 'shipping_fee_minor')::integer,
    (p_order ->> 'subtotal_minor')::integer, (p_order ->> 'total_minor')::integer,
    (p_order ->> 'deposit_due_minor')::integer, (p_order ->> 'due_on_delivery_minor')::integer,
    -- the payment clock starts only when there is a final amount to pay
    case when v_status = 'awaiting_deposit' then now() + make_interval(hours => coalesce(v_hold, 24)) end)
  returning id into v_id;

  insert into public.order_lines (order_id, tenant_id, position, product_id, variant_id, qty, snapshot, total_minor)
  select v_id, p_tenant, e.n::integer, (e.line ->> 'product_id')::uuid, (e.line ->> 'variant_id')::uuid,
         (e.line ->> 'qty')::integer, e.line -> 'snapshot', (e.line ->> 'total_minor')::integer
    from jsonb_array_elements(p_lines) with ordinality as e(line, n);

  for l in
    select (e ->> 'variant_id')::uuid as variant_id, (e ->> 'qty')::integer as qty
      from jsonb_array_elements(p_lines) e
      where e ->> 'variant_id' is not null
      order by 1
  loop
    perform public.hold_stock(p_tenant, l.variant_id, l.qty, v_id);
  end loop;

  for l in
    select (e ->> 'product_id')::uuid as product_id, (e ->> 'resource_id')::uuid as resource_id,
           (e ->> 'start')::timestamptz as start
      from jsonb_array_elements(p_lines) e
      where e ->> 'start' is not null
      order by 1, 3
  loop
    perform public.book_slot(p_tenant, l.product_id, l.resource_id, l.start, v_id);
  end loop;

  return v_id;
end;
$$;

comment on function public.order_to_currency(integer, numeric) is
  'TODO(multi-currency): ignores the currency exponent (CLP/PYG) and treats a null rate as the '
  'base currency; callers now refuse a foreign currency without a rate (missing_rate). The '
  'app sells only in the base currency until the multi-currency task fixes this.';

-- ---------------------------------------------------------------- grants (unchanged, restated)
revoke all on function public.release_stock(uuid) from public, anon, authenticated;
grant execute on function public.release_stock(uuid) to service_role;
revoke all on function public.order_reprice(uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_shipping_fee(uuid, uuid, integer, text),
  public.set_quoted_price(uuid, uuid, integer, text),
  public.cancel_order(uuid, uuid, text, text),
  public.expire_orders(timestamptz, integer),
  public.create_order(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_shipping_fee(uuid, uuid, integer, text),
  public.set_quoted_price(uuid, uuid, integer, text),
  public.cancel_order(uuid, uuid, text, text),
  public.expire_orders(timestamptz, integer),
  public.create_order(uuid, jsonb, jsonb)
  to service_role;
