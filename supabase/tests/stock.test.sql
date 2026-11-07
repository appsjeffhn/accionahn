begin;
select plan(49);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into products (id, tenant_id, kind, name, price_minor) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"A","en":"A"}', 1000),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'simple', '{"es":"B","en":"B"}', 2000);
-- a1: stock 1, a2: stock 5, a3: untracked (null), b1: tenant B stock 7
insert into product_variants (id, tenant_id, product_id, label, stock) values
  ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"es":"1","en":"1"}', 1),
  ('30000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"es":"2","en":"2"}', 5),
  ('30000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"es":"3","en":"3"}', null),
  ('30000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 7);
-- stock_reservations.order_id references orders (20261106000019): the orders the holds use
insert into orders (id, tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
select o.id::uuid, '10000000-0000-0000-0000-00000000000a', rpad(replace(o.id, '-', ''), 43, 'x'), 'pending_shipping', 'HNL', 'HNL', 'Test', '+50400000000', 0
  from unnest(array['60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002',
                    '60000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000004',
                    '60000000-0000-0000-0000-000000000005']) as o(id);

-- composite same-tenant FK: a reservation cannot pair tenant A with a tenant B variant
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000b1', 1, 'held')$$, '23503', null, 'reservation must reference a variant of the same tenant');
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 0, 'held')$$, '23514', null, 'qty must be positive');
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 1, 'lost')$$, '23514', null, 'status must be known');

set local role service_role;

-- hold: first succeeds, second fails, stock ends at 0
select isnt(public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a1', 1, '60000000-0000-0000-0000-000000000001'), null, 'first hold returns a reservation id');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a1'), 0, 'stock is 0 after the first hold');
select throws_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a1', 1, '60000000-0000-0000-0000-000000000002')$$, 'P0001', 'insufficient_stock', 'second hold raises insufficient_stock');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a1'), 0, 'stock stays at 0');
select is((select count(*) from stock_reservations where order_id = '60000000-0000-0000-0000-000000000002'), 0::bigint, 'failed hold leaves no reservation');
select throws_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 6, null)$$, 'P0001', 'insufficient_stock', 'asking for more than the stock raises');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 5, 'stock untouched after an oversized hold');
select throws_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 0, null)$$, '22023', null, 'qty 0 rejected');

-- release returns the stock once
select is(public.release_stock('60000000-0000-0000-0000-000000000001'), 1, 'release reports one reservation released');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a1'), 1, 'release returns the stock');
select is(public.release_stock('60000000-0000-0000-0000-000000000001'), 0, 'second release releases nothing');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a1'), 1, 'second release does not return stock again');
select is(public.release_stock('60000000-0000-0000-0000-0000000000ff'), 0, 'release of an unknown order is a no-op');

-- commit then release returns nothing
select isnt(public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 2, '60000000-0000-0000-0000-000000000003'), null, 'hold 2 of 5');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 3, 'stock 3 after hold');
select is(public.commit_stock('60000000-0000-0000-0000-000000000003'), 1, 'commit reports one reservation committed');
select is(public.commit_stock('60000000-0000-0000-0000-000000000003'), 0, 'second commit is a no-op');
select is(public.release_stock('60000000-0000-0000-0000-000000000003'), 0, 'release after commit releases nothing');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 3, 'committed stock is not returned');
select is((select status from stock_reservations where order_id = '60000000-0000-0000-0000-000000000003'), 'committed', 'reservation stays committed');

-- an order with two lines on the same variant is released together
select lives_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 1, '60000000-0000-0000-0000-000000000004')$$, 'hold line 1');
select lives_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 2, '60000000-0000-0000-0000-000000000004')$$, 'hold line 2');
select is(public.release_stock('60000000-0000-0000-0000-000000000004'), 2, 'both lines released');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 3, 'both lines returned to stock');

-- untracked variant: never raises, never changes, release does not invent stock
select lives_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a3', 999, '60000000-0000-0000-0000-000000000005')$$, 'untracked variant can always be held');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a3'), null, 'untracked stock stays null');
select lives_ok($$select public.release_stock('60000000-0000-0000-0000-000000000005')$$, 'releasing an untracked hold works');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a3'), null, 'untracked stock still null after release');

-- tenant isolation
select throws_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000b1', 1, null)$$, '42501', null, 'holding a variant of another tenant raises');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000b1'), 7, 'foreign variant stock untouched');

-- adjust_stock
select is(public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 4), 7, 'adjust adds to the current stock and returns it');
select is(public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', -7), 0, 'adjust can reach 0');
select throws_ok($$select public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', -1)$$, 'P0001', 'insufficient_stock', 'adjust cannot go below 0');
select throws_ok($$select public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a3', 1)$$, 'P0001', 'stock_not_tracked', 'adjust on an untracked variant raises');
select throws_ok($$select public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000b1', 1)$$, '42501', null, 'adjust on a variant of another tenant raises');

-- save_product writes stock only when a variant is inserted
select lives_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-00000000000a","kind":"simple","reservable":false,"name":{"es":"A","en":"A"},"description":{"es":"","en":""},"price_minor":1000,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-0000000000a2","label":{"es":"2","en":"2"},"sku":null,"stock":99,"active":true},{"id":"30000000-0000-0000-0000-0000000000a9","label":{"es":"9","en":"9"},"sku":null,"stock":4,"active":true}]'::jsonb)$$, 'save_product with stock for an existing and a new variant');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), 0, 'save_product ignores stock for an existing variant');
select is((select stock from product_variants where id = '30000000-0000-0000-0000-0000000000a9'), 4, 'save_product writes stock for a new variant');

-- privileges: service_role cannot rewrite reservation quantities or tenants
select throws_ok($$update stock_reservations set qty = 100$$, '42501', null, 'service_role cannot update qty');
select throws_ok($$delete from stock_reservations$$, '42501', null, 'service_role cannot delete reservations');

-- owners read only their own tenant's reservations and cannot call the functions or write
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from stock_reservations where tenant_id = '10000000-0000-0000-0000-00000000000a'), 5::bigint, 'owner A sees tenant A reservations');
select is((select count(*) from stock_reservations where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B reservations');
select throws_ok($$insert into stock_reservations (tenant_id, variant_id, qty, status) values ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 1, 'held')$$, '42501', null, 'owner cannot insert reservations');
select throws_ok($$select public.hold_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 1, null)$$, '42501', null, 'owner cannot call hold_stock');
select throws_ok($$select public.adjust_stock('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-0000000000a2', 1)$$, '42501', null, 'owner cannot call adjust_stock directly');
reset role;
set local role anon;
select throws_ok($$select count(*) from stock_reservations$$, '42501', null, 'anon cannot read reservations');

select * from finish();
rollback;
