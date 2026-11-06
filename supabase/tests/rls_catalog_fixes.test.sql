begin;
select plan(42);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner');

insert into products (id, tenant_id, kind, name, price_minor) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"A","en":"A"}', 1000),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'simple', '{"es":"B","en":"B"}', 2000);
insert into product_variants (id, tenant_id, product_id, label, stock) values
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 7);
insert into date_rules (id, tenant_id, label, kind, value, weekdays) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '{"es":"A","en":"A"}', 'percent', 10, array[5]),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 'fixed', 500, array[6]);
insert into shipping_zones (id, tenant_id, label, fee_minor) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '{"es":"A","en":"A"}', 100);
insert into store_settings (tenant_id) values ('10000000-0000-0000-0000-00000000000a');

-- shape checks on jsonb and timezone columns
select throws_ok($$update products set deposit = '{"kind":"percent","value":0}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit percent 0 rejected');
select throws_ok($$update products set deposit = '{"kind":"percent","value":101}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit percent 101 rejected');
select throws_ok($$update products set deposit = '{"kind":"fixed","value":-1}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit fixed negative rejected');
select throws_ok($$update products set deposit = '{"kind":"fixed","value":1.5}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit fixed fractional rejected');
select throws_ok($$update products set deposit = '{"kind":"none","value":5}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit none with value rejected');
select throws_ok($$update products set deposit = '{"kind":"loan","value":5}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit unknown kind rejected');
select throws_ok($$update products set deposit = '{"kind":"fixed","value":"5"}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'deposit string value rejected');
select lives_ok($$update products set deposit = '{"kind":"percent","value":50}' where id = '20000000-0000-0000-0000-00000000000a'$$, 'deposit percent 50 accepted');
select throws_ok($$update products set fixed_prices = '{"USD":-5}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'negative fixed price rejected');
select throws_ok($$update products set fixed_prices = '{"USD":1.5}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'fractional fixed price rejected');
select throws_ok($$update products set fixed_prices = '{"USD":"5"}' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'string fixed price rejected');
select lives_ok($$update products set fixed_prices = '{"USD":500}' where id = '20000000-0000-0000-0000-00000000000a'$$, 'integer fixed price accepted');
select throws_ok($$update products set configurable = '[1]' where id = '20000000-0000-0000-0000-00000000000a'$$, '23514', null, 'configurable must be an object');
select throws_ok($$update store_settings set timezone = 'Mars/Olympus'$$, '23514', null, 'unknown timezone rejected');
select throws_ok($$update store_settings set timezone = ''$$, '23514', null, 'empty timezone rejected');
select lives_ok($$update store_settings set timezone = 'America/New_York'$$, 'real timezone accepted');

-- save_product RPC as service_role
set local role service_role;

select is(
  public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-0000000000a1","kind":"simple","reservable":false,"name":{"es":"N","en":"N"},"description":{"es":"","en":""},"price_minor":900,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":["x.png"],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-0000000000a1","label":{"es":"v1","en":"v1"},"sku":null,"stock":3,"active":true},{"id":"30000000-0000-0000-0000-0000000000a2","label":{"es":"v2","en":"v2"},"sku":"S2","stock":null,"active":true}]'::jsonb),
  '20000000-0000-0000-0000-0000000000a1'::uuid, 'save_product creates a product and returns its id');
select is((select count(*) from product_variants where product_id = '20000000-0000-0000-0000-0000000000a1'), 2::bigint, 'variants created');
select is((select images from products where id = '20000000-0000-0000-0000-0000000000a1'), array['x.png'], 'images stored');

-- retry with the same ids creates no duplicates
select lives_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-0000000000a1","kind":"simple","reservable":false,"name":{"es":"N","en":"N"},"description":{"es":"","en":""},"price_minor":900,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-0000000000a1","label":{"es":"v1","en":"v1"},"sku":null,"stock":3,"active":true},{"id":"30000000-0000-0000-0000-0000000000a2","label":{"es":"v2","en":"v2"},"sku":"S2","stock":null,"active":true}]'::jsonb)$$, 'retrying the same save works');
select is((select count(*) from product_variants where product_id = '20000000-0000-0000-0000-0000000000a1'), 2::bigint, 'retry created no duplicate variants');
select is((select count(*) from products where tenant_id = '10000000-0000-0000-0000-00000000000a'), 2::bigint, 'retry created no duplicate product');

-- omitted variants are deactivated, not deleted; null variants leaves them alone
select lives_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-0000000000a1","kind":"simple","reservable":false,"name":{"es":"N2","en":"N2"},"description":{"es":"","en":""},"price_minor":950,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-0000000000a1","label":{"es":"v1","en":"v1"},"sku":null,"stock":3,"active":true}]'::jsonb)$$, 'save with fewer variants works');
select is((select active from product_variants where id = '30000000-0000-0000-0000-0000000000a2'), false, 'omitted variant deactivated');
select is((select price_minor from products where id = '20000000-0000-0000-0000-0000000000a1'), 950, 'existing product updated');
select lives_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-0000000000a1","kind":"simple","reservable":false,"name":{"es":"N2","en":"N2"},"description":{"es":"","en":""},"price_minor":950,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb, null)$$, 'null variants leaves variants alone');
select is((select count(*) from product_variants where product_id = '20000000-0000-0000-0000-0000000000a1' and active), 1::bigint, 'variants untouched when null');

-- a foreign variant id raises and moves nothing
select throws_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-0000000000a1","kind":"simple","reservable":false,"name":{"es":"N2","en":"N2"},"description":{"es":"","en":""},"price_minor":950,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-00000000000b","label":{"es":"stolen","en":"stolen"},"sku":null,"stock":0,"active":true}]'::jsonb)$$, '42501', null, 'foreign variant id raises');
select is((select tenant_id::text || '/' || product_id::text || '/' || stock::text || '/' || (label->>'es') from product_variants where id = '30000000-0000-0000-0000-00000000000b'),
  '10000000-0000-0000-0000-00000000000b/20000000-0000-0000-0000-00000000000b/7/B', 'tenant B variant unchanged');
select is((select price_minor from products where id = '20000000-0000-0000-0000-0000000000a1'), 950, 'failed save rolled back the product write');

-- a variant id that belongs to another product of the same tenant also raises
select throws_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-00000000000a","kind":"simple","reservable":false,"name":{"es":"A","en":"A"},"description":{"es":"","en":""},"price_minor":1000,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb,
    '[{"id":"30000000-0000-0000-0000-0000000000a1","label":{"es":"x","en":"x"},"sku":null,"stock":1,"active":true}]'::jsonb)$$, '42501', null, 'variant of another product raises');

-- a product of another tenant raises
select throws_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a',
    '{"id":"20000000-0000-0000-0000-00000000000b","kind":"simple","reservable":false,"name":{"es":"hack","en":"hack"},"description":{"es":"","en":""},"price_minor":1,"fixed_prices":{},"configurable":null,"deposit":{"kind":"none","value":0},"images":[],"active":true}'::jsonb, null)$$, '42501', null, 'product of another tenant raises');
select is((select price_minor from products where id = '20000000-0000-0000-0000-00000000000b'), 2000, 'tenant B product unchanged');

-- service_role cannot rewrite tenant columns directly
select throws_ok($$update products set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = '20000000-0000-0000-0000-00000000000a'$$, '42501', null, 'service_role cannot change products.tenant_id');
select throws_ok($$update product_variants set product_id = '20000000-0000-0000-0000-00000000000a' where id = '30000000-0000-0000-0000-00000000000b'$$, '42501', null, 'service_role cannot change product_variants.product_id');
select throws_ok($$update product_variants set tenant_id = '10000000-0000-0000-0000-00000000000a' where id = '30000000-0000-0000-0000-00000000000b'$$, '42501', null, 'service_role cannot change product_variants.tenant_id');

-- RPC is service_role only
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null)$$, '42501', null, 'authenticated cannot call save_product');

-- cross-tenant UPDATE and DELETE as owner A change nothing; tenant_id is immutable
update product_variants set stock = 0 where tenant_id = '10000000-0000-0000-0000-00000000000b';
update date_rules set value = 99 where tenant_id = '10000000-0000-0000-0000-00000000000b';
delete from product_variants where tenant_id = '10000000-0000-0000-0000-00000000000b';
delete from date_rules where tenant_id = '10000000-0000-0000-0000-00000000000b';
select throws_ok($$update date_rules set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = '40000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change date_rules.tenant_id');
select throws_ok($$update shipping_zones set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = '50000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change shipping_zones.tenant_id');
reset role;
select is((select stock from product_variants where id = '30000000-0000-0000-0000-00000000000b'), 7, 'B variant not updated or deleted by owner A');
select is((select value from date_rules where id = '40000000-0000-0000-0000-00000000000b'), 500::numeric, 'B date rule not updated or deleted by owner A');

set local role anon;
select throws_ok($$select public.save_product('10000000-0000-0000-0000-00000000000a', '{}'::jsonb, null)$$, '42501', null, 'anon cannot call save_product');

select * from finish();
rollback;
