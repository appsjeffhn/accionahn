begin;
select plan(44);

-- Final-review fixes of the store (20261106000022_fix_wave.sql). Own tenants and ids, so
-- the assertions do not depend on other data in the database (for example Spezia).
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000f00a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-fw@test.local');
insert into tenants (id, slug, name, status) values
  ('1f000000-0000-0000-0000-00000000000a', 'fix-wave-a', 'Fix wave A', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000f00a1', '1f000000-0000-0000-0000-00000000000a', 'owner');
insert into store_settings (tenant_id, hold_hours, timezone) values
  ('1f000000-0000-0000-0000-00000000000a', 24, 'America/Tegucigalpa');
-- p1: two active variants; p2: only an inactive variant; p3: no variants
insert into products (id, tenant_id, kind, reservable, name, price_minor, active) values
  ('2f000000-0000-0000-0000-0000000000a1', '1f000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"P1","en":"P1"}', 1000, true),
  ('2f000000-0000-0000-0000-0000000000a2', '1f000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"P2","en":"P2"}', 1000, true),
  ('2f000000-0000-0000-0000-0000000000a3', '1f000000-0000-0000-0000-00000000000a', 'simple', false, '{"es":"P3","en":"P3"}', 1000, true);
insert into product_variants (id, tenant_id, product_id, label, stock, active) values
  ('3f000000-0000-0000-0000-0000000000a1', '1f000000-0000-0000-0000-00000000000a', '2f000000-0000-0000-0000-0000000000a1', '{"es":"1","en":"1"}', 10, true),
  ('3f000000-0000-0000-0000-0000000000a2', '1f000000-0000-0000-0000-00000000000a', '2f000000-0000-0000-0000-0000000000a1', '{"es":"2","en":"2"}', 10, true),
  ('3f000000-0000-0000-0000-0000000000a3', '1f000000-0000-0000-0000-00000000000a', '2f000000-0000-0000-0000-0000000000a2', '{"es":"3","en":"3"}', 10, false);

create function pg_temp.ord(p_token text, p_status text, p_over jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object(
    'public_token', rpad(p_token, 43, 'x'), 'status', p_status, 'currency', 'HNL', 'base_currency', 'HNL',
    'exchange_rate', null, 'customer_name', 'Ana',
    'customer_phone', '+5048' || lpad((abs(hashtext(p_token)) % 10000000)::text, 7, '0'),
    'fields', '{}'::jsonb, 'shipping_zone_id', null, 'shipping_prepay', false,
    'shipping_fee_minor', case when p_status like 'pending%' then null else 0 end,
    'subtotal_minor', 1000,
    'total_minor', case when p_status like 'pending%' then null else 1000 end,
    'deposit_due_minor', case when p_status = 'awaiting_deposit' then 300 when p_status like 'pending%' then null else 0 end,
    'due_on_delivery_minor', case when p_status = 'awaiting_deposit' then 700 when p_status like 'pending%' then null else 1000 end)
  || p_over
$$;
create function pg_temp.line(p_product text, p_variant text, p_qty integer, p_pending boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('product_id', p_product, 'variant_id', p_variant, 'qty', p_qty,
    'total_minor', case when p_pending then 0 else 500 end, 'start', null, 'resource_id', null,
    'snapshot', jsonb_build_object('lineId', 'l', 'totalMinor', case when p_pending then 0 else 500 end,
      'pendingQuote', p_pending, 'deposit', jsonb_build_object('kind', 'percent', 'value', 30),
      'depositMinor', null, 'depositFixedMinor', null))
$$;
create function pg_temp.oid(p_token text) returns uuid
language sql as $$ select id from public.orders where public_token = rpad(p_token, 43, 'x') $$;
create function pg_temp.stock(p_variant text) returns integer
language sql as $$ select stock from public.product_variants where id = p_variant::uuid $$;

-- ---------------------------------------------------------------- privileges (A3, A4)
select ok(not has_column_privilege('authenticated', 'public.product_variants', 'stock', 'UPDATE'),
  'owners cannot write variant stock directly (adjust_stock only)');
select ok(has_column_privilege('authenticated', 'public.product_variants', 'active', 'UPDATE')
  and has_column_privilege('authenticated', 'public.product_variants', 'label', 'UPDATE')
  and has_column_privilege('authenticated', 'public.product_variants', 'stock', 'INSERT'),
  'owners still update label/active and set the stock of a new variant');
select ok(has_column_privilege('service_role', 'public.product_variants', 'stock', 'UPDATE'),
  'service_role keeps UPDATE on stock (hold/release/adjust run as invoker)');
select ok(not has_column_privilege('service_role', 'public.store_settings', 'tenant_id', 'UPDATE'),
  'service_role cannot move store_settings to another tenant');
select ok(not has_table_privilege('service_role', 'public.store_settings', 'UPDATE'),
  'service_role has no table-wide UPDATE on store_settings');
select is(
  (select array_agg(c order by c) from unnest(array['shipping_mode', 'fixed_fee_minor', 'shipping_prepay',
     'payment_instructions', 'hold_hours', 'per_line_date', 'timezone', 'theme']) c
     where has_column_privilege('service_role', 'public.store_settings', c, 'UPDATE')),
  array['fixed_fee_minor', 'hold_hours', 'payment_instructions', 'per_line_date', 'shipping_mode',
        'shipping_prepay', 'theme', 'timezone'],
  'service_role updates every settings column the stores write');
select ok(has_table_privilege('service_role', 'public.store_settings', 'INSERT')
  and has_table_privilege('service_role', 'public.store_settings', 'SELECT'),
  'service_role still inserts and reads store_settings');

-- replaced functions keep their security mode, empty search_path and grants
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef::text || ':' || array_to_string(p.proconfig, ',') order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('release_stock', 'order_reprice', 'set_shipping_fee',
       'set_quoted_price', 'cancel_order', 'expire_orders', 'create_order')),
  array['cancel_order:true:search_path=""', 'create_order:false:search_path=""', 'expire_orders:true:search_path=""',
        'order_reprice:false:search_path=""', 'release_stock:false:search_path=""',
        'set_quoted_price:true:search_path=""', 'set_shipping_fee:true:search_path=""'],
  'replaced functions keep security mode and empty search_path');
select is(
  (select array_agg(p.proname::text || ':' || r || ':' || has_function_privilege(r, p.oid, 'execute')::text order by p.proname, r)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join unnest(array['anon', 'authenticated', 'service_role']) r
     where n.nspname = 'public' and p.proname in ('release_stock', 'order_reprice', 'set_shipping_fee',
       'set_quoted_price', 'cancel_order', 'expire_orders', 'create_order')),
  array['cancel_order:anon:false', 'cancel_order:authenticated:false', 'cancel_order:service_role:true',
        'create_order:anon:false', 'create_order:authenticated:false', 'create_order:service_role:true',
        'expire_orders:anon:false', 'expire_orders:authenticated:false', 'expire_orders:service_role:true',
        'order_reprice:anon:false', 'order_reprice:authenticated:false', 'order_reprice:service_role:false',
        'release_stock:anon:false', 'release_stock:authenticated:false', 'release_stock:service_role:true',
        'set_quoted_price:anon:false', 'set_quoted_price:authenticated:false', 'set_quoted_price:service_role:true',
        'set_shipping_fee:anon:false', 'set_shipping_fee:authenticated:false', 'set_shipping_fee:service_role:true'],
  'execute matrix of the replaced functions is unchanged');

-- ---------------------------------------------------------------- lock order (A1, A8)
select ok(pg_get_functiondef('public.release_stock(uuid)'::regprocedure) ~ 'order by pv\.id for no key update',
  'release_stock pre-locks variants in id order');
select ok(pg_get_functiondef('public.expire_orders(timestamptz, integer)'::regprocedure) ~ 'order by pv\.id for no key update'
  and pg_get_functiondef('public.expire_orders(timestamptz, integer)'::regprocedure) ~ 'skip locked',
  'expire_orders skips locked orders and pre-locks their variants in id order');
select ok(pg_get_functiondef('public.cancel_order(uuid, uuid, text, text)'::regprocedure) ~ 'order by pv\.id for no key update'
  and pg_get_functiondef('public.cancel_order(uuid, uuid, text, text)'::regprocedure) !~ 'order by pv\.id for update',
  'cancel_order locks variants for no key update');

-- ---------------------------------------------------------------- checks and index (A5, A7, A9)
select throws_ok($$insert into orders (tenant_id, public_token, status, currency, base_currency, customer_name,
    customer_phone, subtotal_minor, total_minor, deposit_due_minor, due_on_delivery_minor, hold_expires_at)
  values ('1f000000-0000-0000-0000-00000000000a', rpad('nohold', 43, 'x'), 'awaiting_deposit', 'HNL', 'HNL', 'Ana',
    '+50480000001', 1000, 1000, 300, 700, null)$$,
  '23514', null, 'awaiting_deposit needs a payment deadline');
select throws_ok($$insert into date_rules (tenant_id, label, kind, value, weekdays)
  values ('1f000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', 'fixed', 1.5, array[1])$$,
  '23514', null, 'a fixed date surcharge must be a whole number of minor units');
select lives_ok($$insert into date_rules (tenant_id, label, kind, value, weekdays)
  values ('1f000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', 'percent', 1.5, array[1])$$,
  'a percent date surcharge may have decimals');
select ok(exists (select 1 from pg_indexes where tablename = 'bookings' and indexname = 'bookings_tenant_during_live_idx'
    and indexdef ~* 'using gist \(tenant_id, during\)' and indexdef ~ 'released'),
  'bookings has a gist index on (tenant_id, during) for live bookings');

-- ---------------------------------------------------------------- owner and store writes
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000f00a1","role":"authenticated"}';
select throws_ok($$update product_variants set stock = 0 where id = '3f000000-0000-0000-0000-0000000000a1'$$,
  '42501', null, 'an owner cannot overwrite the stock of their own variant');
select lives_ok($$update product_variants set active = true where id = '3f000000-0000-0000-0000-0000000000a1'$$,
  'an owner can still change other variant columns');
reset role;

set local role service_role;
-- the statements the settings and theme stores send
select lives_ok($$update store_settings set theme = '{"accent":"#000000"}', hold_hours = 12
  where tenant_id = '1f000000-0000-0000-0000-00000000000a'$$, 'service_role updates settings by tenant');
select throws_ok($$update store_settings set tenant_id = '1f000000-0000-0000-0000-00000000000a'
  where tenant_id = '1f000000-0000-0000-0000-00000000000a'$$, '42501', null, 'service_role cannot write store_settings.tenant_id');
select throws_ok($$insert into store_settings (tenant_id, theme) values ('1f000000-0000-0000-0000-00000000000a', '{}')
  on conflict (tenant_id) do update set tenant_id = excluded.tenant_id, theme = excluded.theme$$,
  '42501', null, 'an upsert that rewrites tenant_id (PostgREST upsert) is refused');

-- ---------------------------------------------------------------- variants (A6)
select throws_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('inact1', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a2', null, 1)))$$,
  'P0001', 'variant_required', 'a product whose variants are all inactive cannot be ordered without a variant');
select throws_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('inact2', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a2', '3f000000-0000-0000-0000-0000000000a3', 1)))$$,
  'P0001', 'product_unavailable', 'nor with its inactive variant');
select is((select count(*) from orders where public_token in (rpad('inact1', 43, 'x'), rpad('inact2', 43, 'x'))), 0::bigint,
  'no order was created for the inactive-only product');
select lives_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('novar', 'awaiting_review'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1)))$$,
  'a product without any variant is still orderable');

-- ---------------------------------------------------------------- missing rate (A2)
select throws_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a',
  pg_temp.ord('usd1', 'pending_shipping', '{"currency":"USD"}'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1)))$$,
  'P0001', 'missing_rate', 'a pending_shipping order in another currency needs a rate');
select throws_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a',
  pg_temp.ord('usd2', 'pending_quote', '{"currency":"USD"}'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1, true)))$$,
  'P0001', 'missing_rate', 'a pending_quote order in another currency needs a rate');
select lives_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a',
  pg_temp.ord('usd3', 'pending_shipping', '{"currency":"USD","exchange_rate":4}'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1)))$$,
  'with a rate the pending order is created');
reset role;

-- orders created before this check (inserted directly): the owner cannot price them
insert into orders (tenant_id, public_token, status, currency, base_currency, exchange_rate, customer_name,
  customer_phone, subtotal_minor) values
  ('1f000000-0000-0000-0000-00000000000a', rpad('legacy1', 43, 'x'), 'pending_shipping', 'USD', 'HNL', null, 'Ana', '+50480000002', 500),
  ('1f000000-0000-0000-0000-00000000000a', rpad('legacy2', 43, 'x'), 'pending_quote', 'USD', 'HNL', null, 'Ana', '+50480000003', 0);
insert into order_lines (order_id, tenant_id, position, product_id, variant_id, qty, snapshot, total_minor)
select o.id, o.tenant_id, 1, '2f000000-0000-0000-0000-0000000000a3', null, 1,
       (pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1, o.status = 'pending_quote')) -> 'snapshot',
       case when o.status = 'pending_quote' then 0 else 500 end
  from orders o where o.public_token in (rpad('legacy1', 43, 'x'), rpad('legacy2', 43, 'x'));

select throws_ok($$select public.order_reprice(pg_temp.oid('legacy1'))$$, 'P0001', 'missing_rate',
  'order_reprice refuses a foreign-currency order without a rate');
set local role service_role;
select throws_ok($$select public.set_shipping_fee('1f000000-0000-0000-0000-00000000000a', pg_temp.oid('legacy1'), 100,
  'owner:00000000-0000-0000-0000-0000000f00a1')$$, 'P0001', 'missing_rate', 'set_shipping_fee refuses it');
select throws_ok($$select public.set_quoted_price('1f000000-0000-0000-0000-00000000000a', pg_temp.oid('legacy2'), 100,
  'owner:00000000-0000-0000-0000-0000000f00a1')$$, 'P0001', 'missing_rate', 'set_quoted_price refuses it');
select is((select array_agg((status, shipping_fee_minor, total_minor)::text order by public_token) from orders
             where public_token in (rpad('legacy1', 43, 'x'), rpad('legacy2', 43, 'x'))),
  array['(pending_shipping,,)', '(pending_quote,,)'], 'both orders are unchanged');
-- a base-currency order still prices normally
select lives_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('base1', 'pending_shipping'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a3', null, 1)))$$, 'base-currency pending order');
select is(public.set_shipping_fee('1f000000-0000-0000-0000-00000000000a', pg_temp.oid('base1'), 100,
  'owner:00000000-0000-0000-0000-0000000f00a1'), 'awaiting_deposit', 'base-currency order is priced');

-- ---------------------------------------------------------------- expiry of multi-variant orders (A1)
select lives_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('multi1', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a1', '3f000000-0000-0000-0000-0000000000a2', 2),
                    pg_temp.line('2f000000-0000-0000-0000-0000000000a1', '3f000000-0000-0000-0000-0000000000a1', 3)))$$,
  'order holding two variants');
select lives_ok($$select public.create_order('1f000000-0000-0000-0000-00000000000a', pg_temp.ord('multi2', 'awaiting_deposit'),
  jsonb_build_array(pg_temp.line('2f000000-0000-0000-0000-0000000000a1', '3f000000-0000-0000-0000-0000000000a1', 1),
                    pg_temp.line('2f000000-0000-0000-0000-0000000000a1', '3f000000-0000-0000-0000-0000000000a2', 4)))$$,
  'second order holding the same two variants (opposite line order)');
select is(array[pg_temp.stock('3f000000-0000-0000-0000-0000000000a1'), pg_temp.stock('3f000000-0000-0000-0000-0000000000a2')],
  array[6, 4], 'both orders hold their units');
reset role;
update orders set hold_expires_at = now() - interval '1 minute'
  where public_token in (rpad('multi1', 43, 'x'), rpad('multi2', 43, 'x'));
set local role service_role;
select ok(public.expire_orders(now(), 7) >= 2, 'the sweep cancels the expired orders');
select is((select array_agg(status order by public_token) from orders
             where public_token in (rpad('multi1', 43, 'x'), rpad('multi2', 43, 'x'))),
  array['cancelled', 'cancelled'], 'both multi-variant orders are cancelled');
select is((select count(*) from stock_reservations
             where order_id in (pg_temp.oid('multi1'), pg_temp.oid('multi2')) and status <> 'released'), 0::bigint,
  'every reservation of both orders is released');
select is(array[pg_temp.stock('3f000000-0000-0000-0000-0000000000a1'), pg_temp.stock('3f000000-0000-0000-0000-0000000000a2')],
  array[10, 10], 'every unit is back');
select lives_ok($$select public.expire_orders(now(), 7)$$, 'a second sweep runs');
select is(public.release_stock(pg_temp.oid('multi1')), 0, 'a direct release afterwards releases nothing');
select is(array[pg_temp.stock('3f000000-0000-0000-0000-0000000000a1'), pg_temp.stock('3f000000-0000-0000-0000-0000000000a2')],
  array[10, 10], 'stock is released once, never twice');
reset role;

select * from finish();
rollback;
