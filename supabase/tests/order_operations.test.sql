begin;
select plan(152);

-- Owner operations, proof review and expiry (20261106000020_order_operations.sql).
-- Day for slots: Monday 2099-03-02 in America/Tegucigalpa, one resource, 60-minute service.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into store_settings (tenant_id, hold_hours, timezone) values
  ('10000000-0000-0000-0000-00000000000a', 24, 'America/Tegucigalpa'),
  ('10000000-0000-0000-0000-00000000000b', 24, 'America/Tegucigalpa');
insert into products (id, tenant_id, kind, reservable, name, price_minor, active) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"Encurtido","en":"Pickle"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Pastel","en":"Cake"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'simple', false, '{"es":"B","en":"B"}', 1000, true);
-- a1: plenty of stock for orders whose stock is not under test; the others are 10 each
insert into product_variants (id, tenant_id, product_id, label, stock, active) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"1","en":"1"}', 1000, true),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"2","en":"2"}', 10, true),
  ('30000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"3","en":"3"}', 10, true),
  ('30000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"4","en":"4"}', 10, true),
  ('30000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"5","en":"5"}', 10, true),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '{"es":"B","en":"B"}', 10, true);
insert into product_calendar (product_id, tenant_id, prep_minutes, service_minutes, slot_step_minutes, max_days_ahead) values
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 0, 60, 30, 36500);
insert into resources (id, tenant_id, name) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'r1');
insert into working_hours (tenant_id, resource_id, weekday, opens, closes) values
  ('10000000-0000-0000-0000-00000000000a', null, 1, '08:00', '20:00');

-- Order header (same shape as orders.test.sql); p_over replaces any key.
create function pg_temp.ord(p_token text, p_status text, p_over jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'public_token', rpad(p_token, 43, 'x'), 'status', p_status, 'currency', 'HNL', 'base_currency', 'HNL',
    'exchange_rate', null, 'customer_name', 'Ana',
    'customer_phone', '+5049' || lpad((abs(hashtext(p_token)) % 10000000)::text, 7, '0'),
    'fields', '{}'::jsonb, 'shipping_zone_id', null, 'shipping_prepay', false,
    'shipping_fee_minor', case when p_status like 'pending%' then null else 0 end,
    'subtotal_minor', 1000,
    'total_minor', case when p_status like 'pending%' then null else 1000 end,
    'deposit_due_minor', case when p_status = 'awaiting_deposit' then 300 when p_status like 'pending%' then null else 0 end,
    'due_on_delivery_minor', case when p_status = 'awaiting_deposit' then 700 when p_status like 'pending%' then null else 1000 end)
  || p_over
$$;
-- Line snapshot as written by createOrder: amounts plus the product's deposit definition.
create function pg_temp.snap(p_total integer, p_kind text, p_value numeric, p_fixed integer default null,
  p_pending boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('lineId', 'l', 'totalMinor', p_total, 'pendingQuote', p_pending,
    'deposit', jsonb_build_object('kind', p_kind, 'value', p_value),
    'depositMinor', case when p_pending then null end, 'depositFixedMinor', p_fixed)
$$;
create function pg_temp.line(p_variant text, p_qty integer, p_total integer, p_snap jsonb, p_start text default null) returns jsonb
language sql as $$
  select jsonb_build_object(
    'product_id', case when p_start is null then '20000000-0000-0000-0000-0000000000a1' else '20000000-0000-0000-0000-0000000000a2' end,
    'variant_id', p_variant, 'qty', p_qty, 'total_minor', p_total,
    'start', (p_start || ' America/Tegucigalpa')::timestamptz, 'resource_id', null, 'snapshot', p_snap)
$$;
-- one stock line (a1, qty 1, 1000, 30 % deposit)
create function pg_temp.std() returns jsonb
language sql as $$
  select jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 1000, pg_temp.snap(1000, 'percent', 30)))
$$;
create function pg_temp.oid(p_token text) returns uuid
language sql as $$ select id from public.orders where public_token = rpad(p_token, 43, 'x') $$;
create function pg_temp.tok(p_token text) returns text
language sql as $$ select rpad(p_token, 43, 'x') $$;
create function pg_temp.path(p_token text) returns text
language sql as $$ select '10000000-0000-0000-0000-00000000000a/' || pg_temp.oid(p_token) || '/' || gen_random_uuid() $$;
create function pg_temp.st(p_token text) returns text
language sql as $$ select status from public.orders where id = pg_temp.oid(p_token) $$;
create function pg_temp.last_event(p_token text) returns text
language sql as $$
  select (from_status, to_status, actor, reason)::text from public.order_events
    where order_id = pg_temp.oid(p_token) order by at desc limit 1
$$;
create function pg_temp.stock(p_variant text) returns integer
language sql as $$ select stock from public.product_variants where id = p_variant::uuid $$;
-- move an order's creation and history back in time (expiry tests)
create function pg_temp.age(p_token text, p_days integer) returns void
language sql as $$
  update public.orders set created_at = created_at - make_interval(days => p_days) where id = pg_temp.oid(p_token);
  update public.order_events set at = at - make_interval(days => p_days) where order_id = pg_temp.oid(p_token);
$$;

\set A '\'10000000-0000-0000-0000-00000000000a\''
\set B '\'10000000-0000-0000-0000-00000000000b\''
\set OWNER '\'owner:00000000-0000-0000-0000-0000000000a1\''

-- ---------------------------------------------------------------- schema and privileges
select is((select relrowsecurity from pg_class where oid = 'public.order_proofs'::regclass), true,
  'RLS is enabled on order_proofs');
select is(has_any_column_privilege('service_role', 'public.orders', 'UPDATE'), false,
  'service_role still has no UPDATE on orders: every change goes through the functions');
select is(has_any_column_privilege('service_role', 'public.order_proofs', 'INSERT'), false,
  'service_role cannot insert proofs directly');
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('set_shipping_fee', 'set_quoted_price', 'submit_proof',
       'approve_proof', 'reject_proof', 'cancel_order', 'expire_orders')),
  array['approve_proof:true:search_path=""', 'cancel_order:true:search_path=""', 'expire_orders:true:search_path=""',
        'reject_proof:true:search_path=""', 'set_quoted_price:true:search_path=""', 'set_shipping_fee:true:search_path=""',
        'submit_proof:true:search_path=""'],
  'the seven operations are security definer with an empty search_path');
select is(
  (select array_agg(r || ':' || has_function_privilege(r, p.oid, 'execute')::text order by p.proname, r)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated', 'service_role']) r
     where n.nspname = 'public' and p.proname in ('set_shipping_fee', 'expire_orders')),
  array['anon:false', 'authenticated:false', 'service_role:true', 'anon:false', 'authenticated:false', 'service_role:true'],
  'only service_role may execute the operations');
select ok(exists (select 1 from pg_indexes where tablename = 'stock_reservations' and indexdef like '%(order_id)%')
  and exists (select 1 from pg_indexes where tablename = 'bookings' and indexdef like '%(order_id)%'),
  'stock_reservations and bookings are indexed by order_id');

set local role service_role;

-- ---------------------------------------------------------------- set_shipping_fee
-- two 1001 lines at 30 %: each line deposit rounds on its own (300 + 300), as the engine does
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ship1', 'pending_shipping', '{"subtotal_minor":2002}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 2, 1001, pg_temp.snap(1001, 'percent', 30)),
                    pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 1001, pg_temp.snap(1001, 'percent', 30))))$$,
  'pending_shipping order');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship1'), 150, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit',
  'setting the fee moves the order to awaiting_deposit');
select is((select (shipping_fee_minor, subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor)::text
             from orders where id = pg_temp.oid('ship1')),
  '(150,2002,2152,600,1552)', 'total = subtotal + fee; deposit from the line definitions, fee not prepaid');
select is((select hold_expires_at from orders where id = pg_temp.oid('ship1')), now() + interval '24 hours',
  'the payment clock starts now (hold_hours)');
select is(pg_temp.last_event('ship1'), '(pending_shipping,awaiting_deposit,owner:00000000-0000-0000-0000-0000000000a1,)',
  'the change is logged with the owner as actor');
select is((select array_agg((snapshot ->> 'depositMinor')::integer order by position) from order_lines where order_id = pg_temp.oid('ship1')),
  array[300, 300], 'line snapshots carry the recomputed deposits');
select throws_ok($$select public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship1'), 200, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'invalid_status', 'an order already awaiting_deposit cannot take a new fee');

-- USD order at 4 HNL per USD, fee prepaid: 1002 HNL -> 250.5 -> 251 (half up)
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ship2', 'pending_shipping',
    '{"currency":"USD","exchange_rate":4,"shipping_prepay":true,"subtotal_minor":400}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 400, pg_temp.snap(400, 'percent', 25))))$$,
  'USD pending_shipping order with prepaid shipping');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship2'), 1002, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'USD order priced');
select is((select (shipping_fee_minor, total_minor, deposit_due_minor, due_on_delivery_minor)::text from orders where id = pg_temp.oid('ship2')),
  '(1002,651,351,300)', 'the base-currency fee is converted half up and added to the deposit when prepaid');

-- fixed deposit capped at the line total, full deposit, fee 0
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ship3', 'pending_shipping', '{"subtotal_minor":800}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 500, pg_temp.snap(500, 'fixed', 1000, 1000)),
                    pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 300, pg_temp.snap(300, 'full', 0))))$$,
  'order with fixed and full deposits');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship3'), 0, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'fee 0 is a valid fee');
select is((select (total_minor, deposit_due_minor, due_on_delivery_minor)::text from orders where id = pg_temp.oid('ship3')),
  '(800,800,0)', 'fixed deposit is capped at the line total; full takes the whole line');

-- nothing to pay up front: straight to the owner's review, no payment clock
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ship4', 'pending_shipping', '{"subtotal_minor":800}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 800, pg_temp.snap(800, 'none', 0))))$$,
  'order without deposit');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship4'), 200, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_review', 'no deposit: awaiting_review');
select is((select (total_minor, deposit_due_minor, due_on_delivery_minor, hold_expires_at)::text from orders where id = pg_temp.oid('ship4')),
  '(1000,0,1000,)', 'pay on delivery has no hold_expires_at');

select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ship5', 'pending_shipping'), pg_temp.std())$$, 'another pending order');
select throws_ok($$select public.set_shipping_fee('10000000-0000-0000-0000-00000000000b', pg_temp.oid('ship5'), 100, 'owner:00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'the owner of another tenant cannot set the fee');
select throws_ok($$select public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), 100, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'order_not_found', 'an unknown order is order_not_found');
select throws_ok($$select public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship5'), -1, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  '22023', null, 'a negative fee is refused');
select throws_ok($$select public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship5'), 100, 'system')$$,
  '22023', null, 'owner operations need an owner actor');
select is(pg_temp.st('ship5'), 'pending_shipping', 'refused calls change nothing');

-- ---------------------------------------------------------------- set_quoted_price
-- priced line 1000 at 30 % + out-of-range line at 50 %, zone fee 100 already known
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('quote1', 'pending_quote', '{"shipping_fee_minor":100}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 1000, pg_temp.snap(1000, 'percent', 30)),
                    pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 50, null, true))))$$,
  'pending_quote order with a known fee');
select is(public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote1'), 5000, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'quoting prices the order');
select is((select (subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor)::text from orders where id = pg_temp.oid('quote1')),
  '(6000,6100,2800,3300)', 'quoted line 5000 (deposit 2500) + 1000 (300) + fee 100');
select is((select (total_minor, snapshot ->> 'totalMinor', snapshot ->> 'pendingQuote', snapshot ->> 'depositMinor')::text
             from order_lines where order_id = pg_temp.oid('quote1') and position = 2),
  '(5000,5000,false,2500)', 'the quoted line and its snapshot carry the price');
select throws_ok($$select public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote1'), 5000, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'invalid_status', 'a priced order cannot be quoted again');
select is((select (snapshot ->> 'baseMinor', snapshot ->> 'extrasMinor', snapshot ->> 'dateMinor')::text
             from order_lines where order_id = pg_temp.oid('quote1') and position = 2),
  '(5000,0,0)', 'the quoted line has no extras or date amount: base + extras + date = total');
-- two unpriced lines: one price cannot be split, refused until per-line quoting exists
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('quote5', 'pending_quote', '{"shipping_fee_minor":0,"subtotal_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true)),
                    pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true))))$$,
  'pending_quote order with two unpriced lines');
select throws_ok($$select public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote5'), 1000, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  '22023', null, 'a single price for several unpriced lines is refused');
select is((select (status, total_minor)::text from orders where id = pg_temp.oid('quote5')), '(pending_quote,)', 'quote5 unchanged');

-- approval shipping: quote first (-> pending_shipping), then the fee
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('quote2', 'pending_quote', '{"subtotal_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true))))$$,
  'pending_quote order without fee');
select is(public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote2'), 2000, 'owner:00000000-0000-0000-0000-0000000000a1'), 'pending_shipping', 'quoted but no fee yet');
select is((select (subtotal_minor, total_minor, hold_expires_at)::text from orders where id = pg_temp.oid('quote2')),
  '(2000,,)', 'the subtotal is known, the total is not');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote2'), 100, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'then the fee prices it');
select is((select (total_minor, deposit_due_minor)::text from orders where id = pg_temp.oid('quote2')), '(2100,600)', 'totals after both');

-- fee first: the order stays pending_quote
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('quote3', 'pending_quote', '{"subtotal_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true))))$$,
  'pending_quote order, fee first');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote3'), 100, 'owner:00000000-0000-0000-0000-0000000000a1'), 'pending_quote', 'the fee alone does not price it');
select is((select (shipping_fee_minor, total_minor)::text from orders where id = pg_temp.oid('quote3')), '(100,)', 'fee stored, no total');
select is(public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote3'), 1000, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'the quote completes it');
select is((select (total_minor, deposit_due_minor)::text from orders where id = pg_temp.oid('quote3')), '(1100,300)', 'totals');

-- USD: the quote is in base currency; 1002 HNL / 4 = 250.5 -> 251; 50 % of 251 = 125.5 -> 126
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('quote4', 'pending_quote',
    '{"currency":"USD","exchange_rate":4,"subtotal_minor":0,"shipping_fee_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 50, null, true))))$$,
  'USD pending_quote order');
select is(public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('quote4'), 1002, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_deposit', 'USD quote');
select is((select (total_minor, deposit_due_minor, due_on_delivery_minor)::text from orders where id = pg_temp.oid('quote4')),
  '(251,126,125)', 'the quote is converted half up and the deposit rounds half up');
select throws_ok($$select public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship5'), 1000, 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'invalid_status', 'an order with nothing to quote is refused');

-- ---------------------------------------------------------------- submit_proof and approve_proof
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('pay1', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a2', 2, 500, pg_temp.snap(500, 'percent', 30)),
                    pg_temp.line(null, 1, 500, pg_temp.snap(500, 'percent', 30), '2099-03-02 10:00')))$$,
  'awaiting_deposit order with stock and a slot');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a2'), 8, 'stock held');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay1'), pg_temp.tok('pay1'), pg_temp.path('pay1'), 'image/png', 1000)$$,
  'the customer submits a proof');
select is(pg_temp.st('pay1'), 'awaiting_review', 'the order awaits review');
select is(pg_temp.last_event('pay1'), '(awaiting_deposit,awaiting_review,customer,)', 'logged as the customer');
select is((select (status, content_type, size_bytes)::text from order_proofs where order_id = pg_temp.oid('pay1')),
  '(pending,image/png,1000)', 'the proof is recorded as pending');

select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('pay2', 'awaiting_deposit'), pg_temp.std())$$, 'second awaiting order');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), pg_temp.tok('pay1'), pg_temp.path('pay2'), 'image/png', 1000)$$,
  'P0001', 'order_unavailable', 'the token of another order is refused');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000b', pg_temp.oid('pay2'), pg_temp.tok('pay2'), pg_temp.path('pay2'), 'image/png', 1000)$$,
  'P0001', 'order_unavailable', 'another tenant gets the same error as an unknown order');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', gen_random_uuid(), pg_temp.tok('pay2'), pg_temp.path('pay2'), 'image/png', 1000)$$,
  'P0001', 'order_unavailable', 'an unknown order gets the same error');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), pg_temp.tok('pay2'),
    '10000000-0000-0000-0000-00000000000b/' || pg_temp.oid('pay2') || '/' || gen_random_uuid(), 'image/png', 1000)$$,
  '22023', null, 'a path outside <tenant>/<order>/ is refused');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), pg_temp.tok('pay2'), pg_temp.path('pay2'), 'text/html', 1000)$$,
  '22023', null, 'text/html is refused');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), pg_temp.tok('pay2'), pg_temp.path('pay2'), 'application/pdf', 6 * 1024 * 1024)$$,
  '22023', null, 'a 6 MB file is refused');
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay1'), pg_temp.tok('pay1'), pg_temp.path('pay1'), 'image/png', 1000)$$,
  'P0001', 'order_not_awaiting_deposit', 'an order under review takes no second proof');
reset role;
update orders set hold_expires_at = now() - interval '1 minute' where id = pg_temp.oid('pay2');
set local role service_role;
select throws_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), pg_temp.tok('pay2'), pg_temp.path('pay2'), 'image/jpeg', 1000)$$,
  'P0001', 'order_expired', 'an expired order takes no proof');
reset role;
update orders set hold_expires_at = now() + interval '1 hour' where id = pg_temp.oid('pay2');
set local role service_role;
select is((select count(*) from order_proofs where order_id = pg_temp.oid('pay2')), 0::bigint, 'no refused call stored a proof');
select is(pg_temp.st('pay2'), 'awaiting_deposit', 'and the order did not move');

select throws_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay2'), 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'invalid_status', 'an order without a proof under review cannot be approved');
select throws_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000b', pg_temp.oid('pay1'), 'owner:00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'the owner of another tenant cannot approve');
select lives_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay1'), 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'the owner approves');
select is((select (status, hold_expires_at)::text from orders where id = pg_temp.oid('pay1')), '(confirmed,)', 'confirmed, no payment clock');
select is((select array_agg(distinct status) from stock_reservations where order_id = pg_temp.oid('pay1')), array['committed'], 'stock committed');
select is((select array_agg(distinct status) from bookings where order_id = pg_temp.oid('pay1')), array['confirmed'], 'slot confirmed');
select is((select status from order_proofs where order_id = pg_temp.oid('pay1')), 'approved', 'proof approved');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a2'), 8, 'committed stock stays taken');

-- late payment: the holds were released (expiry raced the review) -> refuse, keep the order as is
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('pay3', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a5', 1, 1000, pg_temp.snap(1000, 'percent', 30))))$$, 'pay3');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay3'), pg_temp.tok('pay3'), pg_temp.path('pay3'), 'application/pdf', 1000)$$, 'pay3 proof');
select is(public.release_stock(pg_temp.oid('pay3')), 1, 'its stock hold was released');
select throws_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay3'), 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'holds_released', 'approving an order whose stock went back is refused');
select is(pg_temp.st('pay3'), 'awaiting_review', 'the order is unchanged');
select is((select status from stock_reservations where order_id = pg_temp.oid('pay3')), 'released', 'nothing was committed');
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('pay4', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line(null, 1, 1000, pg_temp.snap(1000, 'percent', 30), '2099-03-02 11:00')))$$, 'pay4');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay4'), pg_temp.tok('pay4'), pg_temp.path('pay4'), 'image/webp', 1000)$$, 'pay4 proof');
select is(public.release_booking(pg_temp.oid('pay4')), 1, 'its slot was released');
select throws_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay4'), 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'holds_released', 'approving an order whose slot went back is refused');
-- a reservation that is no longer 'held' for any reason (here already committed) also refuses
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('pay5', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a5', 1, 1000, pg_temp.snap(1000, 'percent', 30))))$$, 'pay5');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay5'), pg_temp.tok('pay5'), pg_temp.path('pay5'), 'image/png', 10)$$, 'pay5 proof');
select is(public.commit_stock(pg_temp.oid('pay5')), 1, 'its hold was committed outside the review');
select throws_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay5'), 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'holds_released', 'approve refuses unless every hold is still held');
select is(pg_temp.st('pay5'), 'awaiting_review', 'pay5 unchanged');

-- ---------------------------------------------------------------- reject_proof
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('rej1', 'awaiting_deposit'), pg_temp.std())$$, 'rej1');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej1'), pg_temp.tok('rej1'), pg_temp.path('rej1'), 'image/png', 10)$$, 'rej1 proof');
select throws_ok($$select public.reject_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej1'), '   ', 'owner:00000000-0000-0000-0000-0000000000a1')$$, '22023', null, 'a reason is required');
select lives_ok($$select public.reject_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej1'), 'blurry photo', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'the owner rejects with a reason');
select is(pg_temp.last_event('rej1'), '(awaiting_review,awaiting_deposit,owner:00000000-0000-0000-0000-0000000000a1,"blurry photo")',
  'the reason is stored in order_events');
select is((select (status, reason)::text from order_proofs where order_id = pg_temp.oid('rej1')), '(rejected,"blurry photo")', 'proof rejected');
select is((select hold_expires_at from orders where id = pg_temp.oid('rej1')), now() + interval '24 hours',
  'a rejection inside the deadline keeps the deadline');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej1'), pg_temp.tok('rej1'), pg_temp.path('rej1'), 'image/png', 10)$$,
  'the customer can upload another proof');
select is(pg_temp.st('rej1'), 'awaiting_review', 'back under review');
select throws_ok($$select public.reject_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('ship4'), 'no', 'owner:00000000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'no_proof', 'a pay-on-delivery order has no proof to reject');

-- deadline already passed: the first rejection grants 12 hours once; later ones never extend it
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('rej2', 'awaiting_deposit'), pg_temp.std())$$, 'rej2');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej2'), pg_temp.tok('rej2'), pg_temp.path('rej2'), 'image/png', 10)$$, 'rej2 proof');
reset role;
update orders set hold_expires_at = now() - interval '1 hour' where id = pg_temp.oid('rej2');
set local role service_role;
select lives_ok($$select public.reject_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej2'), 'wrong amount', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'late first rejection');
select is((select hold_expires_at from orders where id = pg_temp.oid('rej2')), now() + interval '12 hours', 'one 12-hour grace');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej2'), pg_temp.tok('rej2'), pg_temp.path('rej2'), 'image/png', 10)$$, 'rej2 second proof');
reset role;
update orders set hold_expires_at = now() - interval '1 hour' where id = pg_temp.oid('rej2');
set local role service_role;
select lives_ok($$select public.reject_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('rej2'), 'wrong again', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'late second rejection');
select is((select hold_expires_at from orders where id = pg_temp.oid('rej2')), now() - interval '1 hour', 'no second grace');

-- ---------------------------------------------------------------- cancel_order
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('can1', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a3', 3, 500, pg_temp.snap(500, 'percent', 30)),
                    pg_temp.line(null, 1, 500, pg_temp.snap(500, 'percent', 30), '2099-03-02 13:00')))$$, 'can1');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a3'), 7, 'can1 holds 3 units');
select throws_ok($$select public.cancel_order('10000000-0000-0000-0000-00000000000a', pg_temp.oid('can1'), '', 'owner:00000000-0000-0000-0000-0000000000a1')$$, '22023', null, 'cancel needs a reason');
select throws_ok($$select public.cancel_order('10000000-0000-0000-0000-00000000000b', pg_temp.oid('can1'), 'x', 'owner:00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'the owner of another tenant cannot cancel');
select lives_ok($$select public.cancel_order('10000000-0000-0000-0000-00000000000a', pg_temp.oid('can1'), 'customer asked', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'the owner cancels');
select is(pg_temp.last_event('can1'), '(awaiting_deposit,cancelled,owner:00000000-0000-0000-0000-0000000000a1,"customer asked")', 'logged with reason');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a3'), 10, 'stock is back');
select is((select status from bookings where order_id = pg_temp.oid('can1')), 'released', 'the slot is free');
select throws_ok($$select public.cancel_order('10000000-0000-0000-0000-00000000000a', pg_temp.oid('can1'), 'again', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'P0001', 'invalid_status', 'a cancelled order stays cancelled');
select lives_ok($$select public.cancel_order('10000000-0000-0000-0000-00000000000a', pg_temp.oid('pay1'), 'event called off', 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'a confirmed order can be cancelled');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a2'), 10, 'its committed stock comes back');
select is((select array_agg(distinct status) from bookings where order_id = pg_temp.oid('pay1')), array['released'], 'its confirmed slot is freed');

-- ---------------------------------------------------------------- expire_orders
-- exp1: deadline passed -> cancelled, stock and slot back
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp1', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a4', 2, 500, pg_temp.snap(500, 'percent', 30)),
                    pg_temp.line(null, 1, 500, pg_temp.snap(500, 'percent', 30), '2099-03-02 15:00')))$$, 'exp1');
-- exp2: deadline ahead; exp3: fresh pending_shipping
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp2', 'awaiting_deposit'), pg_temp.std())$$, 'exp2');
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp3', 'pending_shipping'), pg_temp.std())$$, 'exp3');
-- exp4: pending_shipping for 8 days
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp4', 'pending_shipping'), pg_temp.std())$$, 'exp4');
-- exp5: created 8 days ago as pending_quote, quoted today -> pending_shipping since today
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp5', 'pending_quote', '{"subtotal_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true))))$$, 'exp5');
-- exp6: confirmed long ago
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp6', 'awaiting_deposit'), pg_temp.std())$$, 'exp6');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('exp6'), pg_temp.tok('exp6'), pg_temp.path('exp6'), 'image/png', 10)$$, 'exp6 proof');
select lives_ok($$select public.approve_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('exp6'), 'owner:00000000-0000-0000-0000-0000000000a1')$$, 'exp6 confirmed');
-- exp7: customer pay-on-delivery order nobody looked at for 8 days
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line(null, 1, 1000, pg_temp.snap(1000, 'none', 0), '2099-03-02 17:00')))$$, 'exp7');
-- exp8: pay-on-delivery after the owner set the fee (the owner acted)
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp8', 'pending_shipping'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 1000, pg_temp.snap(1000, 'none', 0))))$$, 'exp8');
select is(public.set_shipping_fee('10000000-0000-0000-0000-00000000000a', pg_temp.oid('exp8'), 0, 'owner:00000000-0000-0000-0000-0000000000a1'), 'awaiting_review', 'exp8 awaiting_review by the owner');
-- exp9: proof under review for 8 days (the owner must decide)
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp9', 'awaiting_deposit'), pg_temp.std())$$, 'exp9');
select lives_ok($$select public.submit_proof('10000000-0000-0000-0000-00000000000a', pg_temp.oid('exp9'), pg_temp.tok('exp9'), pg_temp.path('exp9'), 'image/png', 10)$$, 'exp9 proof');
-- exp10: pending_quote nobody quoted for 8 days
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('exp10', 'pending_quote', '{"subtotal_minor":0}'),
  jsonb_build_array(pg_temp.line('30000000-0000-0000-0000-0000000000a1', 1, 0, pg_temp.snap(0, 'percent', 30, null, true))))$$, 'exp10');
reset role;
update orders set hold_expires_at = now() - interval '1 minute' where id in (pg_temp.oid('exp1'), pg_temp.oid('exp6'));
do $$ begin
  perform pg_temp.age('exp4', 8); perform pg_temp.age('exp5', 8); perform pg_temp.age('exp6', 30);
  perform pg_temp.age('exp7', 8); perform pg_temp.age('exp8', 8); perform pg_temp.age('exp9', 8); perform pg_temp.age('exp10', 8);
end $$;
set local role service_role;
select is(public.set_quoted_price('10000000-0000-0000-0000-00000000000a', pg_temp.oid('exp5'), 1000, 'owner:00000000-0000-0000-0000-0000000000a1'), 'pending_shipping', 'exp5 quoted today');

select throws_ok($$select public.expire_orders(now(), 0)$$, '22023', null, 'the stale period must be positive');
-- exp1, exp4, exp7, exp10 and rej2 (its deadline passed above)
select is(public.expire_orders(now(), 7), 5, 'five orders expire');
select is(pg_temp.st('exp1'), 'cancelled', 'past deadline: cancelled');
select is(pg_temp.last_event('exp1'), '(awaiting_deposit,cancelled,system,hold_expired)', 'by the system, with the reason');
select is(pg_temp.stock('30000000-0000-0000-0000-0000000000a4'), 10, 'its stock is back');
select is((select status from bookings where order_id = pg_temp.oid('exp1')), 'released', 'its slot is free');
select is(pg_temp.last_event('exp4'), '(pending_shipping,cancelled,system,stale_pending)', 'stuck pending order cancelled');
select is(pg_temp.last_event('exp10'), '(pending_quote,cancelled,system,stale_pending)', 'stuck pending_quote order cancelled');
select is(pg_temp.last_event('exp7'), '(awaiting_review,cancelled,system,pay_on_delivery_unconfirmed)', 'ignored pay-on-delivery order cancelled');
select is((select status from bookings where order_id = pg_temp.oid('exp7')), 'released', 'and its slot freed');
select is(pg_temp.st('rej2'), 'cancelled', 'the rejected order past its deadline expired');
select is(
  (select array_agg(pg_temp.st(t) order by t) from unnest(array['exp2', 'exp3', 'exp5', 'exp6', 'exp8', 'exp9']) t),
  array['awaiting_deposit', 'pending_shipping', 'pending_shipping', 'confirmed', 'awaiting_review', 'awaiting_review'],
  'live deadlines, fresh pending, confirmed, owner-handled and under-review orders are untouched');
select is(public.expire_orders(now(), 7), 0, 'a second run expires nothing');
select is((select count(*) from order_events where order_id = pg_temp.oid('exp1')), 2::bigint, 'and writes no event');

-- ---------------------------------------------------------------- owners read their proofs
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from order_proofs), 0::bigint, 'another tenant sees no proofs');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok((select count(*) from order_proofs) > 0, 'the owner sees the proofs of their tenant');
reset role;
set local role anon;
select throws_ok($$select count(*) from order_proofs$$, '42501', null, 'anon cannot read proofs');
reset role;

select * from finish();
rollback;
