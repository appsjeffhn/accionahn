-- Order operations: the owner prices pending orders (shipping fee, quoted price), the
-- customer submits a payment proof, the owner approves, rejects or cancels, and a
-- scheduled job expires what nobody paid or handled.
--
-- Every operation is a SECURITY DEFINER function with an empty search_path, executable
-- only by service_role. service_role keeps no UPDATE on orders (Task 5) and gets no
-- write privilege on order_proofs, so the rules below (state, token, holds still held,
-- tenant) cannot be skipped by a direct table write from app code. Each function takes
-- the tenant explicitly and checks it against the locked order row; the status trigger
-- of 20261106000019 validates each transition and writes order_events with the actor
-- and reason set here (app.order_actor / app.order_reason).
--
-- Money: shipping fees and quoted prices arrive in the tenant BASE currency and are
-- converted with orders.exchange_rate (half up), like the pricing engine does. Totals are
-- recomputed from order_lines (line totals) and each line's deposit definition in its
-- snapshot, with the same formulas as src/lib/pricing (engine.ts / money.ts): every line
-- deposit is computed from its definition and summed, plus the fee when prepaid.
--
-- Errors (P0001, the message tells them apart): order_not_found, invalid_status,
-- holds_released, no_proof, order_unavailable, order_not_awaiting_deposit, order_expired.
-- 42501: order of another tenant (owner operations). 22023: malformed input.

-- ---------------------------------------------------------------- proofs
create table public.order_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- storage object key: <tenant_id>/<order_id>/<uuid>
  path text not null unique,
  -- the type sniffed from the file's first bytes, never the declared one
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason text check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now(),
  constraint order_proofs_path_shape check (
    path ~ ('^' || tenant_id::text || '/' || order_id::text || '/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$')),
  constraint order_proofs_order_fk foreign key (order_id, tenant_id)
    references public.orders (id, tenant_id) on delete cascade
);
create index order_proofs_tenant_id_idx on public.order_proofs(tenant_id);
create index order_proofs_order_id_idx on public.order_proofs(order_id, tenant_id, created_at);

alter table public.order_proofs enable row level security;
revoke all on public.order_proofs from anon, authenticated, service_role;
create policy order_proofs_select on public.order_proofs for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());
-- Owners and the service role read (the panel signs a URL for the path); only
-- submit_proof, approve_proof and reject_proof write.
grant select on public.order_proofs to authenticated, service_role;

-- Sweeps of expire_orders. stock_reservations and bookings already have order_id
-- indexes (20261106000017 / 20261106000018) for the per-order release.
create index orders_hold_expiry_idx on public.orders(hold_expires_at) where status = 'awaiting_deposit';
create index orders_stale_idx on public.orders(created_at)
  where status in ('pending_shipping', 'pending_quote', 'awaiting_review');

-- ---------------------------------------------------------------- pricing helpers
-- money.ts convertMinor: base minor units -> order currency, half up. rate null = same currency.
create function public.order_to_currency(p_base integer, p_rate numeric) returns integer
language sql immutable set search_path = ''
as $$
  select case when p_rate is null then p_base else floor(p_base / p_rate + 0.5)::integer end
$$;

-- engine.ts line deposit: percent of the line total (half up), fixed amount capped at the
-- line total (depositFixedMinor is the fixed deposit already in the order currency),
-- the whole line, or nothing.
create function public.order_line_deposit(p_total integer, p_snapshot jsonb) returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  v_kind text := p_snapshot -> 'deposit' ->> 'kind';
  v_value numeric := (p_snapshot -> 'deposit' ->> 'value')::numeric;
  v_fixed integer := (p_snapshot ->> 'depositFixedMinor')::integer;
begin
  if v_kind = 'percent' then
    return floor(p_total * v_value / 100 + 0.5)::integer;
  elsif v_kind = 'fixed' then
    if v_fixed is null then
      raise exception 'line snapshot has a fixed deposit without depositFixedMinor' using errcode = '22023';
    end if;
    return least(p_total, v_fixed);
  elsif v_kind = 'full' then
    return p_total;
  elsif v_kind = 'none' then
    return 0;
  end if;
  raise exception 'line snapshot has no deposit definition' using errcode = '22023';
end;
$$;

-- Locks the order for an owner operation and records who acts. Not granted to anyone:
-- only the definer functions below call it.
create function public.order_lock_for_owner(p_tenant uuid, p_order uuid, p_actor text)
returns public.orders
language plpgsql security invoker set search_path = ''
as $$
declare
  r public.orders;
begin
  if p_actor is null or p_actor !~ '^owner:[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$' then
    raise exception 'owner operations need an owner:<user id> actor' using errcode = '22023';
  end if;
  select * into r from public.orders o where o.id = p_order for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if r.tenant_id is distinct from p_tenant then
    raise exception 'order belongs to another tenant' using errcode = '42501';
  end if;
  perform set_config('app.order_actor', p_actor, true);
  perform set_config('app.order_reason', '', true);
  return r;
end;
$$;

-- Recomputes a locked pending order from its lines and fee and moves it on:
-- a line still unpriced -> stays pending_quote; no fee yet -> pending_shipping;
-- otherwise totals are set and the order awaits the deposit (payment clock starts:
-- now + hold_hours) or, with nothing to pay up front, the owner's review.
create function public.order_reprice(p_order uuid) returns text
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

-- ---------------------------------------------------------------- owner: pricing
-- Fee in base currency. Allowed while the order is pending_shipping or pending_quote
-- (fee known before the quote). Returns the new status.
create function public.set_shipping_fee(p_tenant uuid, p_order uuid, p_fee_minor integer, p_actor text)
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
  update public.orders set shipping_fee_minor = p_fee_minor where id = p_order;
  return public.order_reprice(p_order);
end;
$$;

-- Price (base currency) of what the engine could not price: the out-of-range line(s).
-- It goes to the first unpriced line by position; other unpriced lines become 0.
-- Allowed only in pending_quote. Returns the new status.
create function public.set_quoted_price(p_tenant uuid, p_order uuid, p_price_minor integer, p_actor text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_first uuid;
  v_total integer;
begin
  if p_price_minor is null or p_price_minor < 0 then
    raise exception 'price must be a non-negative integer' using errcode = '22023';
  end if;
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status <> 'pending_quote' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  select l.id into v_first from public.order_lines l
    where l.order_id = p_order and l.tenant_id = r.tenant_id
      and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false)
    order by l.position limit 1;
  if v_first is null then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  v_total := public.order_to_currency(p_price_minor, r.exchange_rate);
  update public.order_lines l set
    total_minor = case when l.id = v_first then v_total else 0 end,
    snapshot = l.snapshot || jsonb_build_object(
      'pendingQuote', false,
      'totalMinor', case when l.id = v_first then v_total else 0 end,
      'baseMinor', case when l.id = v_first then v_total else 0 end,
      'quotedBaseMinor', case when l.id = v_first then p_price_minor else 0 end)
    where l.order_id = p_order and l.tenant_id = r.tenant_id
      and coalesce((l.snapshot ->> 'pendingQuote')::boolean, false);
  return public.order_reprice(p_order);
end;
$$;

-- ---------------------------------------------------------------- customer: proof
-- Called after the file is stored. Any mismatch of tenant, order id or token gives the
-- same order_unavailable, so a token never reveals whether another order exists.
create function public.submit_proof(p_tenant uuid, p_order uuid, p_token text, p_path text,
  p_content_type text, p_size_bytes integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_id uuid;
begin
  if p_content_type is null
     or p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'content type not allowed' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 5242880 then
    raise exception 'file size out of range' using errcode = '22023';
  end if;
  select * into r from public.orders o where o.id = p_order for update;
  if not found or r.tenant_id <> p_tenant or p_token is null or r.public_token <> p_token then
    raise exception 'order_unavailable' using errcode = 'P0001';
  end if;
  -- checked after the order, so a foreign tenant cannot tell a bad path from a bad token
  if p_path is null
     or p_path !~ ('^' || p_tenant::text || '/' || p_order::text || '/[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$') then
    raise exception 'proof path must be <tenant>/<order>/<uuid>' using errcode = '22023';
  end if;
  if r.status <> 'awaiting_deposit' then
    raise exception 'order_not_awaiting_deposit' using errcode = 'P0001';
  end if;
  if r.hold_expires_at is null or r.hold_expires_at <= now() then
    raise exception 'order_expired' using errcode = 'P0001';
  end if;

  perform set_config('app.order_actor', 'customer', true);
  perform set_config('app.order_reason', '', true);
  insert into public.order_proofs (order_id, tenant_id, path, content_type, size_bytes)
    values (p_order, p_tenant, p_path, p_content_type, p_size_bytes)
    returning id into v_id;
  update public.orders set status = 'awaiting_review' where id = p_order;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- owner: review
-- Confirms an order under review. Refused when any stock hold or booking of the order is
-- no longer 'held' (released by an expiry or a cancel that raced the review): the stock
-- may already be sold to someone else, so the owner must re-create the order.
create function public.approve_proof(p_tenant uuid, p_order uuid, p_actor text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
begin
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status <> 'awaiting_review' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.stock_reservations s
               where s.order_id = p_order and s.tenant_id = p_tenant and s.status <> 'held')
     or exists (select 1 from public.bookings b
                  where b.order_id = p_order and b.tenant_id = p_tenant and b.status <> 'held') then
    raise exception 'holds_released' using errcode = 'P0001';
  end if;

  perform public.commit_stock(p_order);
  perform public.confirm_booking(p_order);
  update public.order_proofs set status = 'approved'
    where order_id = p_order and tenant_id = p_tenant and status = 'pending';
  update public.orders set status = 'confirmed', hold_expires_at = null where id = p_order;
end;
$$;

-- Back to awaiting_deposit with a reason; the customer may upload another proof.
-- Deadline rule: a rejection never moves the deadline, except that the FIRST rejection
-- of an order whose deadline has already passed (the owner reviewed late) grants 12 hours
-- from now, once. Later rejections keep the deadline, so proof/reject cycles cannot hold
-- stock forever.
create function public.reject_proof(p_tenant uuid, p_order uuid, p_reason text, p_actor text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.orders;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_rejected integer;
  v_hold timestamptz;
begin
  if length(v_reason) = 0 or length(v_reason) > 1000 then
    raise exception 'a reason of 1 to 1000 characters is required' using errcode = '22023';
  end if;
  r := public.order_lock_for_owner(p_tenant, p_order, p_actor);
  if r.status <> 'awaiting_review' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.order_proofs p
                   where p.order_id = p_order and p.tenant_id = p_tenant and p.status = 'pending') then
    raise exception 'no_proof' using errcode = 'P0001';
  end if;

  select count(*) into v_rejected from public.order_proofs p
    where p.order_id = p_order and p.tenant_id = p_tenant and p.status = 'rejected';
  v_hold := case
    when r.hold_expires_at > now() then r.hold_expires_at
    when v_rejected = 0 then now() + interval '12 hours'
    else coalesce(r.hold_expires_at, now())
  end;

  update public.order_proofs set status = 'rejected', reason = v_reason
    where order_id = p_order and tenant_id = p_tenant and status = 'pending';
  perform set_config('app.order_reason', v_reason, true);
  update public.orders set status = 'awaiting_deposit', hold_expires_at = v_hold where id = p_order;
end;
$$;

-- Cancels any live order with a reason and gives everything back: held AND committed
-- stock (a confirmed order that is called off returns its units) and every booking.
create function public.cancel_order(p_tenant uuid, p_order uuid, p_reason text, p_actor text)
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

-- ---------------------------------------------------------------- system: expiry
-- Cancels, as 'system' with a reason, and releases stock and slots of:
--   hold_expired: awaiting_deposit past hold_expires_at;
--   stale_pending: pending_shipping / pending_quote whose last status change is older
--     than p_stale_days (the owner never priced them);
--   pay_on_delivery_unconfirmed: awaiting_review with nothing due up front, no payment
--     clock, older than p_stale_days, on which no owner ever acted.
-- Confirmed and cancelled orders are never touched; repeating the call finds nothing.
-- Rows locked by a running owner operation are skipped and picked up by the next run.
-- Returns how many orders were cancelled.
create function public.expire_orders(p_now timestamptz, p_stale_days integer)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_cut timestamptz;
  v_count integer := 0;
  r record;
begin
  if p_now is null or p_stale_days is null or p_stale_days < 1 then
    raise exception 'now and a positive stale period are required' using errcode = '22023';
  end if;
  v_cut := p_now - make_interval(days => p_stale_days);

  for r in
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
  loop
    perform set_config('app.order_actor', 'system', true);
    perform set_config('app.order_reason', r.reason, true);
    update public.orders set status = 'cancelled' where id = r.id;
    perform public.release_stock(r.id);
    perform public.release_booking(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.order_to_currency(integer, numeric),
  public.order_line_deposit(integer, jsonb),
  public.order_lock_for_owner(uuid, uuid, text),
  public.order_reprice(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_shipping_fee(uuid, uuid, integer, text),
  public.set_quoted_price(uuid, uuid, integer, text),
  public.submit_proof(uuid, uuid, text, text, text, integer),
  public.approve_proof(uuid, uuid, text),
  public.reject_proof(uuid, uuid, text, text),
  public.cancel_order(uuid, uuid, text, text),
  public.expire_orders(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.set_shipping_fee(uuid, uuid, integer, text),
  public.set_quoted_price(uuid, uuid, integer, text),
  public.submit_proof(uuid, uuid, text, text, text, integer),
  public.approve_proof(uuid, uuid, text),
  public.reject_proof(uuid, uuid, text, text),
  public.cancel_order(uuid, uuid, text, text),
  public.expire_orders(timestamptz, integer)
  to service_role;
