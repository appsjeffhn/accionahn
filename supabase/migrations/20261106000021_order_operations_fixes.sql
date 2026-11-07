-- Review fixes for 20261106000020_order_operations.sql (same signatures, same grants:
-- create or replace keeps the privileges set there).
--   approve_proof: locks the order's reservations and bookings before checking that they
--     are all still held, and checks that commit/confirm changed exactly those rows.
--   set_quoted_price: refuses an order with more than one unpriced line (22023) until
--     per-line quoting exists; the quoted line's snapshot has no extras or date amount,
--     so base + extras + date = line total.
--   cancel_order: locks the affected variants in id order before giving stock back
--     (fixed lock order, same as create_order).

create or replace function public.approve_proof(p_tenant uuid, p_order uuid, p_actor text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_stock_total integer;
  v_stock_held integer;
  v_slot_total integer;
  v_slot_held integer;
  v_changed integer;
begin
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status <> 'awaiting_review' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  -- lock first, then count: a concurrent release cannot slip in between check and commit
  perform 1 from (select s.id from public.stock_reservations s
                    where s.order_id = p_order and s.tenant_id = p_tenant order by s.id for update) x;
  perform 1 from (select b.id from public.bookings b
                    where b.order_id = p_order and b.tenant_id = p_tenant order by b.id for update) x;
  select count(*), count(*) filter (where s.status = 'held') into v_stock_total, v_stock_held
    from public.stock_reservations s where s.order_id = p_order and s.tenant_id = p_tenant;
  select count(*), count(*) filter (where b.status = 'held') into v_slot_total, v_slot_held
    from public.bookings b where b.order_id = p_order and b.tenant_id = p_tenant;
  if v_stock_held <> v_stock_total or v_slot_held <> v_slot_total then
    raise exception 'holds_released' using errcode = 'P0001';
  end if;

  v_changed := public.commit_stock(p_order);
  if v_changed <> v_stock_held then
    raise exception 'holds_released' using errcode = 'P0001';
  end if;
  v_changed := public.confirm_booking(p_order);
  if v_changed <> v_slot_held then
    raise exception 'holds_released' using errcode = 'P0001';
  end if;

  update public.order_proofs set status = 'approved'
    where order_id = p_order and tenant_id = p_tenant and status = 'pending';
  update public.orders set status = 'confirmed', hold_expires_at = null where id = p_order;
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
  select count(*) into v_unpriced from public.order_lines l
    where l.order_id = p_order and l.tenant_id = r.tenant_id
      and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false);
  if v_unpriced = 0 then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if v_unpriced > 1 then
    raise exception 'one price cannot be split over several unpriced lines' using errcode = '22023';
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
      order by pv.id for update) x;

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
