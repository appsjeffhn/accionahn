begin;
select plan(95);

-- Day under test: Monday 2099-03-02 in America/Tegucigalpa (UTC-6). Tenant A has one
-- resource, so any two bookings at the same time collide.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active'),
  ('10000000-0000-0000-0000-00000000000c', 'tenant-c', 'Tenant C', 'pending');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into store_settings (tenant_id, hold_hours, timezone) values
  ('10000000-0000-0000-0000-00000000000a', 24, 'America/Tegucigalpa'),
  ('10000000-0000-0000-0000-00000000000b', 48, 'America/Tegucigalpa');
-- a1: pickles with variants; a2: inactive; a3, a4: reservable; a5: no variants, not reservable
insert into products (id, tenant_id, kind, reservable, name, price_minor, active) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"Encurtido","en":"Pickle"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"Viejo","en":"Old"}', 1000, false),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Pastel","en":"Cake"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Corte","en":"Cut"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"Salsa","en":"Sauce"}', 1000, true),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'simple', false, '{"es":"B","en":"B"}', 1000, true);
-- v1 stock 1, v2 stock 10, v3 of the inactive product, v4 inactive variant of a1
insert into product_variants (id, tenant_id, product_id, label, stock, active) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"1","en":"1"}', 1, true),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"2","en":"2"}', 10, true),
  ('30000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '{"es":"3","en":"3"}', 5, true),
  ('30000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '{"es":"4","en":"4"}', 5, false),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '{"es":"B","en":"B"}', 7, true);
insert into product_calendar (product_id, tenant_id, prep_minutes, service_minutes, slot_step_minutes, max_days_ahead) values
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 0, 60, 30, 36500),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 0, 60, 30, 36500);
insert into resources (id, tenant_id, name) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'r1');
insert into working_hours (tenant_id, resource_id, weekday, opens, closes) values
  ('10000000-0000-0000-0000-00000000000a', null, 1, '08:00', '20:00');
insert into shipping_zones (id, tenant_id, label, fee_minor) values
  ('50000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '{"es":"Centro","en":"Downtown"}', 150),
  ('50000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 150);

-- Order header payload. Pending statuses carry no totals; final ones carry consistent ones.
-- Each token gets its own phone unless one is given (the abuse limit counts per phone).
create function pg_temp.ord(p_token text, p_status text, p_phone text default null) returns jsonb
language sql as $$
  select jsonb_build_object(
    'public_token', rpad(p_token, 43, 'x'), 'status', p_status, 'currency', 'HNL', 'base_currency', 'HNL',
    'exchange_rate', null, 'customer_name', 'Ana',
    'customer_phone', coalesce(p_phone, '+5049' || lpad((abs(hashtext(p_token)) % 10000000)::text, 7, '0')),
    'fields', '{"address":"Centro"}'::jsonb, 'shipping_zone_id', null, 'shipping_prepay', false,
    'shipping_fee_minor', case when p_status like 'pending%' then null else 0 end,
    'subtotal_minor', 1000,
    'total_minor', case when p_status like 'pending%' then null else 1000 end,
    'deposit_due_minor', case when p_status = 'awaiting_deposit' then 300 when p_status like 'pending%' then null else 0 end,
    'due_on_delivery_minor', case when p_status = 'awaiting_deposit' then 700 when p_status like 'pending%' then null else 1000 end)
$$;
create function pg_temp.line(p_product text, p_variant text default null, p_qty integer default 1, p_start text default null) returns jsonb
language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', p_variant, 'qty', p_qty, 'total_minor', 1000,
    'start', p_start::timestamptz, 'resource_id', null, 'snapshot', jsonb_build_object('lineId', 'l'))
$$;
create function pg_temp.oid(p_token text) returns uuid
language sql as $$ select id from public.orders where public_token = rpad(p_token, 43, 'x') $$;

-- schema
select is((select bool_and(relrowsecurity) from pg_class
             where oid in ('public.orders'::regclass, 'public.order_lines'::regclass, 'public.order_events'::regclass)),
  true, 'RLS is enabled on orders, order_lines and order_events');
select is(
  (select array_agg(f || '>' || t order by f collate "C", t collate "C")
     from unnest(array['pending_shipping','pending_quote','awaiting_deposit','awaiting_review','confirmed','cancelled']) f
     cross join unnest(array['pending_shipping','pending_quote','awaiting_deposit','awaiting_review','confirmed','cancelled']) t
     where public.order_transition_allowed(f, t)),
  array['awaiting_deposit>awaiting_review','awaiting_deposit>cancelled',
        'awaiting_review>awaiting_deposit','awaiting_review>cancelled','awaiting_review>confirmed',
        'confirmed>cancelled',
        'pending_quote>awaiting_deposit','pending_quote>awaiting_review','pending_quote>cancelled','pending_quote>pending_shipping',
        'pending_shipping>awaiting_deposit','pending_shipping>awaiting_review','pending_shipping>cancelled'],
  'the SQL transition table is exactly the documented one (same as states.ts)');

set local role service_role;

-- happy path: final total, stock line and a slot
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok1', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 1),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1, '2099-03-02 10:00 America/Tegucigalpa')))$$,
  'create_order with a stock line and a reservable line');
select is((select status from orders where id = pg_temp.oid('tok1')), 'awaiting_deposit', 'the order is awaiting_deposit');
select is((select hold_expires_at from orders where id = pg_temp.oid('tok1')), now() + interval '24 hours', 'a final total sets hold_expires_at to now + hold_hours');
select is((select (total_minor, deposit_due_minor, due_on_delivery_minor)::text from orders where id = pg_temp.oid('tok1')), '(1000,300,700)', 'totals are stored');
select is((select fields from orders where id = pg_temp.oid('tok1')), '{"address":"Centro"}'::jsonb, 'custom fields are stored');
select is((select count(*) from order_lines where order_id = pg_temp.oid('tok1')), 2::bigint, 'both lines are stored');
select is((select array_agg(position order by position) from order_lines where order_id = pg_temp.oid('tok1')), array[1, 2], 'lines keep the cart order');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a1'), 0, 'the stock line took the last unit');
select is((select (qty, status)::text from stock_reservations where order_id = pg_temp.oid('tok1')), '(1,held)', 'the reservation is held for the real order id');
select is((select (status, lower(during))::text from bookings where order_id = pg_temp.oid('tok1')),
  (select ('held', '2099-03-02 10:00 America/Tegucigalpa'::timestamptz)::text), 'the slot is held for the real order id');
select is((select count(*) from order_events where order_id = pg_temp.oid('tok1')), 1::bigint, 'creation writes one event');
select is((select (from_status, to_status, actor, reason)::text from order_events where order_id = pg_temp.oid('tok1')),
  '(,awaiting_deposit,customer,)', 'the creation event goes from nothing to the first status, by the customer');

-- approval shipping: no total, no expiry, but stock and slot are held
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok2', 'pending_shipping'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2', 2),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a4', null, 1, '2099-03-02 12:00 America/Tegucigalpa')))$$,
  'create_order without a final total');
select is((select (status, total_minor, deposit_due_minor, hold_expires_at)::text from orders where id = pg_temp.oid('tok2')),
  '(pending_shipping,,,)', 'pending_shipping: no total, no deposit, no hold_expires_at');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 8, 'pending_shipping holds stock');
select is((select count(*) from bookings where order_id = pg_temp.oid('tok2') and status = 'held'), 1::bigint, 'pending_shipping holds the slot');

-- all or nothing: a taken slot leaves no order, no stock hold
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok3', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a2', 1),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1, '2099-03-02 10:30 America/Tegucigalpa')))$$,
  'P0001', 'slot_taken', 'a taken slot fails the whole order');
select is(pg_temp.oid('tok3'), null, 'no order row is left');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 8, 'no stock is left held');
select is((select count(*) from stock_reservations where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2::bigint, 'no reservation row is left');
select is((select count(*) from order_lines where tenant_id = '10000000-0000-0000-0000-00000000000a'), 4::bigint, 'no line row is left');

-- insufficient stock: no order and no booking
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok4', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1, '2099-03-02 15:00 America/Tegucigalpa'),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 1)))$$,
  'P0001', 'insufficient_stock', 'exhausted stock fails the whole order');
select is(pg_temp.oid('tok4'), null, 'no order row is left');
select is((select count(*) from bookings where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2::bigint, 'no booking is left');

-- per-line dates: two reservable lines, two bookings; one failure books nothing
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok5', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a4', null, 1, '2099-03-02 16:00 America/Tegucigalpa'),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1, '2099-03-02 14:00 America/Tegucigalpa')))$$,
  'two reservable lines at different times');
select is((select array_agg(lower(during) order by lower(during)) from bookings where order_id = pg_temp.oid('tok5')),
  array['2099-03-02 14:00 America/Tegucigalpa'::timestamptz, '2099-03-02 16:00 America/Tegucigalpa'::timestamptz], 'each line has its own booking');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok6', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1, '2099-03-02 17:00 America/Tegucigalpa'),
                    pg_temp.line('20000000-0000-0000-0000-0000000000a4', null, 1, '2099-03-02 12:00 America/Tegucigalpa')))$$,
  'P0001', 'slot_taken', 'the second booking fails');
select is((select count(*) from bookings where lower(during) = '2099-03-02 17:00 America/Tegucigalpa'), 0::bigint, 'the first booking of the failed order is rolled back');

-- product, variant and start checks happen inside the transaction
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-0000000000a3', 1)))$$,
  'P0001', 'product_unavailable', 'an inactive product is refused');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b1', 1)))$$,
  'P0001', 'product_unavailable', 'a product of another tenant is refused like an unknown one');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a3', 1)))$$,
  'P0001', 'product_unavailable', 'a variant of another product is refused');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a4', 1)))$$,
  'P0001', 'product_unavailable', 'an inactive variant is refused');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a1', null, 1)))$$,
  'P0001', 'variant_required', 'a product with active variants needs one');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a3', null, 1)))$$,
  'P0001', 'start_required', 'a reservable line needs a start');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5', null, 1, '2099-03-02 10:00 America/Tegucigalpa')))$$,
  '22023', null, 'a line that is not reservable takes no start');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000c', pg_temp.ord('tok7', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$,
  '42501', null, 'a tenant that is not active takes no orders');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'confirmed'),
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$,
  '22023', null, 'an order cannot be created confirmed');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('tok7', 'awaiting_review'), '[]'::jsonb)$$,
  '22023', null, 'an order needs lines');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a',
  pg_temp.ord('tok7', 'awaiting_review') || '{"shipping_zone_id":"50000000-0000-0000-0000-0000000000b1"}'::jsonb,
  jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$,
  '23503', null, 'a shipping zone of another tenant is refused');
select is((select count(*) from orders where public_token = rpad('tok7', 43, 'x')), 0::bigint, 'refused orders leave nothing');

-- abuse limit: three pending orders per phone and tenant
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ph1', 'pending_shipping', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$, 'pending order 1 of the phone');
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ph2', 'awaiting_deposit', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$, 'pending order 2 of the phone');
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ph3', 'awaiting_review', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$, 'pending order 3 of the phone');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ph4', 'pending_quote', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$,
  'P0001', 'too_many_pending_orders', 'the fourth pending order of the phone is refused');
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000b', pg_temp.ord('ph5', 'pending_shipping', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000b1', '30000000-0000-0000-0000-0000000000b1')))$$,
  'the limit is per tenant');
reset role;
update orders set status = 'cancelled' where id = pg_temp.oid('ph1');
set local role service_role;
select lives_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', pg_temp.ord('ph4', 'pending_quote', '+50488887777'), jsonb_build_array(pg_temp.line('20000000-0000-0000-0000-0000000000a5')))$$,
  'a cancelled order no longer counts');

-- service_role writes only through create_order
select throws_ok($$update orders set status = 'confirmed'$$, '42501', null, 'service_role cannot update orders directly');
select throws_ok($$delete from orders$$, '42501', null, 'service_role cannot delete orders');
select throws_ok($$insert into order_events (order_id, tenant_id, to_status, actor) values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-00000000000a', 'confirmed', 'x')$$,
  '42501', null, 'service_role cannot forge order events');
reset role;

-- token and shape constraints
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('tok1', 43, 'x'), 'pending_shipping', 'HNL', 'HNL', 'Ana', '+50411112222', 0)$$,
  '23505', null, 'public_token is unique');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
  values ('10000000-0000-0000-0000-00000000000a', 'short', 'pending_shipping', 'HNL', 'HNL', 'Ana', '+50411112222', 0)$$,
  '23514', null, 'public_token must be 43 base64url characters');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('shape1', 43, 'x'), 'awaiting_deposit', 'HNL', 'HNL', 'Ana', '+50411112222', 0)$$,
  '23514', null, 'a final status needs totals');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('shape2', 43, 'x'), 'awaiting_deposit', 'HNL', 'HNL', 'Ana', '+50411112222', 10, 10, 0, 10)$$,
  '23514', null, 'awaiting_deposit needs a deposit above zero');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('shape3', 43, 'x'), 'awaiting_review', 'HNL', 'HNL', 'Ana', '+50411112222', 10, 10, 3, 3)$$,
  '23514', null, 'deposit plus due on delivery must equal the total');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('shape4', 43, 'x'), 'pending_shipping', 'HNL', 'HNL', 'Ana', 'call me', 0)$$,
  '23514', null, 'the phone is stored normalized');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor)
  values ('10000000-0000-0000-0000-00000000000a', rpad('shape5', 43, 'x'), 'confirmed', 'HNL', 'HNL', 'Ana', '+50411112222', 10, 10, 0, 10)$$,
  'P0001', 'invalid_initial_status', 'an order cannot start confirmed');
select throws_ok($$insert into order_lines (order_id, tenant_id, position, product_id, qty, snapshot, total_minor)
  values (pg_temp.oid('tok1'), '10000000-0000-0000-0000-00000000000a', 9, '20000000-0000-0000-0000-0000000000b1', 1, '{}', 0)$$,
  '23503', null, 'an order line cannot use a product of another tenant');
select throws_ok($$insert into order_lines (order_id, tenant_id, position, product_id, qty, snapshot, total_minor)
  values (pg_temp.oid('ph5'), '10000000-0000-0000-0000-00000000000a', 9, '20000000-0000-0000-0000-0000000000a5', 1, '{}', 0)$$,
  '23503', null, 'an order line cannot join an order of another tenant');

-- the new foreign keys on stock_reservations and bookings
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, order_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', '60000000-0000-0000-0000-0000000000ff', 1, 'held')$$,
  '23503', null, 'a reservation must point at an existing order');
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, order_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', pg_temp.oid('ph5'), 1, 'held')$$,
  '23503', null, 'a reservation cannot point at an order of another tenant');
select lives_ok($$insert into stock_reservations (tenant_id, variant_id, order_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', null, 1, 'released')$$,
  'a reservation without order is still allowed');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, order_id, during, status) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-0000000000ff', tstzrange('2099-03-02 19:00 America/Tegucigalpa', '2099-03-02 19:30 America/Tegucigalpa'), 'held')$$,
  '23503', null, 'a booking must point at an existing order');

-- status machine: valid changes log an event with actor and reason; invalid ones are refused
select set_config('app.order_actor', 'owner:a1', true);
select set_config('app.order_reason', 'proof uploaded', true);
select lives_ok($$update orders set status = 'awaiting_review' where id = pg_temp.oid('tok1')$$, 'awaiting_deposit -> awaiting_review');
select is((select (from_status, to_status, actor, reason)::text from order_events where order_id = pg_temp.oid('tok1') and from_status is not null),
  '(awaiting_deposit,awaiting_review,owner:a1,"proof uploaded")', 'the change is logged with actor and reason');
select set_config('app.order_reason', '', true);
select lives_ok($$update orders set status = 'confirmed' where id = pg_temp.oid('tok1')$$, 'awaiting_review -> confirmed');
select throws_ok($$update orders set status = 'awaiting_deposit' where id = pg_temp.oid('tok1')$$, 'P0001', 'invalid_transition', 'confirmed -> awaiting_deposit is refused');
select throws_ok($$update orders set status = 'pending_shipping' where id = pg_temp.oid('tok1')$$, 'P0001', 'invalid_transition', 'confirmed -> pending_shipping is refused');
select lives_ok($$update orders set status = 'cancelled' where id = pg_temp.oid('tok1')$$, 'confirmed -> cancelled');
select throws_ok($$update orders set status = 'confirmed' where id = pg_temp.oid('tok1')$$, 'P0001', 'invalid_transition', 'cancelled -> confirmed is refused');
select throws_ok($$update orders set status = 'awaiting_deposit' where id = pg_temp.oid('tok1')$$, 'P0001', 'invalid_transition', 'nothing leaves cancelled');
select lives_ok($$update orders set status = 'cancelled' where id = pg_temp.oid('tok1')$$, 'an update to the same status is not a transition');
select is((select array_agg(to_status order by at) from order_events where order_id = pg_temp.oid('tok1')),
  array['awaiting_deposit','awaiting_review','confirmed','cancelled'], 'one event per real change, none for refused or repeated ones');
select is((select actor from order_events where order_id = pg_temp.oid('tok1') and to_status = 'confirmed'), 'owner:a1', 'the actor setting applies to every change in the transaction');
select is((select reason from order_events where order_id = pg_temp.oid('tok1') and to_status = 'confirmed'), null, 'an empty reason is stored as null');
select throws_ok($$update orders set status = 'confirmed' where id = pg_temp.oid('tok2')$$, 'P0001', 'invalid_transition', 'pending_shipping -> confirmed is refused');
select set_config('app.order_actor', '', true);
select lives_ok($$update orders set status = 'cancelled' where id = pg_temp.oid('tok2')$$, 'pending_shipping -> cancelled');
select is((select actor from order_events where order_id = pg_temp.oid('tok2') and to_status = 'cancelled'), 'system', 'without an actor setting the actor is system');

-- owners read only their own tenant; nobody but create_order writes
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from orders where tenant_id = '10000000-0000-0000-0000-00000000000a') > 0, true, 'owner A sees tenant A orders');
select is((select count(*) from orders where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B orders');
select is((select count(*) from order_lines where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B lines');
select is((select count(*) from order_events where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B events');
select is((select count(*) from order_events where order_id = pg_temp.oid('tok1')), 4::bigint, 'owner A reads the history of their orders');
select throws_ok($$update orders set status = 'cancelled' where tenant_id = '10000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change status directly');
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor) values ('10000000-0000-0000-0000-00000000000a', rpad('own1', 43, 'x'), 'pending_shipping', 'HNL', 'HNL', 'Ana', '+50411112222', 0)$$,
  '42501', null, 'owner cannot insert orders');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, '[]'::jsonb)$$, '42501', null, 'owner cannot call create_order');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*) from orders where tenant_id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'owner B sees no tenant A orders');
select is((select count(*) from orders where tenant_id = '10000000-0000-0000-0000-00000000000b'), 1::bigint, 'owner B sees their own order');
reset role;
set local role anon;
select throws_ok($$select count(*) from orders$$, '42501', null, 'anon cannot read orders');
select throws_ok($$select count(*) from order_lines$$, '42501', null, 'anon cannot read order lines');
select throws_ok($$select count(*) from order_events$$, '42501', null, 'anon cannot read order events');
select throws_ok($$select public.create_order('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, '[]'::jsonb)$$, '42501', null, 'anon cannot call create_order');
reset role;

-- deleting a tenant still cascades through orders, lines, events, reservations and bookings
select lives_ok($$delete from tenants where id = '10000000-0000-0000-0000-00000000000a'$$, 'a tenant with orders can be deleted');
select is((select count(*) from order_events where tenant_id = '10000000-0000-0000-0000-00000000000a'), 0::bigint, 'its order history goes with it');

select * from finish();
rollback;
