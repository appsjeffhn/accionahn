begin;
select plan(43);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');

insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');

insert into products (id, tenant_id, kind, name, price_minor) values
  ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"A","en":"A"}', 1000),
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'simple', '{"es":"B","en":"B"}', 2000);
insert into product_variants (id, tenant_id, product_id, label, stock) values
  ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"es":"A","en":"A"}', 5),
  ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', null);
insert into date_rules (id, tenant_id, label, kind, value, weekdays) values
  ('40000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '{"es":"A","en":"A"}', 'percent', 10, array[5]),
  ('40000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 'fixed', 500, array[6]);
insert into shipping_zones (id, tenant_id, label, fee_minor) values
  ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '{"es":"A","en":"A"}', 100),
  ('50000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '{"es":"B","en":"B"}', 200);
insert into store_settings (tenant_id) values
  ('10000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-00000000000b');

-- table constraints and defaults (superuser)
select is((select hold_hours from store_settings where tenant_id = '10000000-0000-0000-0000-00000000000a'), 24, 'hold_hours defaults to 24');
select is((select timezone from store_settings where tenant_id = '10000000-0000-0000-0000-00000000000a'), 'America/Tegucigalpa', 'timezone default');
select throws_ok($$insert into products (tenant_id, kind, name, price_minor) values ('10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"x","en":"x"}', -1)$$, '23514', null, 'negative price rejected');
select throws_ok($$insert into products (tenant_id, kind, name) values ('10000000-0000-0000-0000-00000000000a', 'bundle', '{"es":"x","en":"x"}')$$, '23514', null, 'unknown kind rejected');
select throws_ok($$insert into products (tenant_id, kind, name, configurable) values ('10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"x","en":"x"}', '{"tiers":[]}')$$, '23514', null, 'simple product with configurable rejected');
select throws_ok($$insert into product_variants (tenant_id, product_id, label, stock) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', -1)$$, '23514', null, 'negative stock rejected');
select throws_ok($$insert into product_variants (tenant_id, product_id, label) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000b', '{"es":"x","en":"x"}')$$, '23503', null, 'variant tenant must match its product tenant');
select throws_ok($$insert into date_rules (tenant_id, label, kind, value) values ('10000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', 'percent', 5)$$, '23514', null, 'date rule matching nothing rejected');
select throws_ok($$insert into date_rules (tenant_id, label, kind, value, weekdays) values ('10000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', 'percent', -5, array[1])$$, '23514', null, 'negative date rule value rejected');
select throws_ok($$insert into date_rules (tenant_id, label, kind, value, weekdays) values ('10000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', 'percent', 5, array[7])$$, '23514', null, 'weekday outside 0-6 rejected');
select throws_ok($$insert into shipping_zones (tenant_id, label, fee_minor) values ('10000000-0000-0000-0000-00000000000a', '{"es":"x","en":"x"}', -1)$$, '23514', null, 'negative zone fee rejected');
select throws_ok($$update store_settings set hold_hours = 0 where tenant_id = '10000000-0000-0000-0000-00000000000a'$$, '23514', null, 'hold_hours below 1 rejected');
select throws_ok($$update store_settings set hold_hours = 169 where tenant_id = '10000000-0000-0000-0000-00000000000a'$$, '23514', null, 'hold_hours above 168 rejected');
select throws_ok($$update store_settings set shipping_mode = 'drone' where tenant_id = '10000000-0000-0000-0000-00000000000a'$$, '23514', null, 'unknown shipping mode rejected');

-- RLS is on and the privilege model is explicit
select is((select count(*) from pg_class where oid in ('public.products'::regclass, 'public.product_variants'::regclass, 'public.date_rules'::regclass, 'public.shipping_zones'::regclass, 'public.store_settings'::regclass) and relrowsecurity), 5::bigint, 'RLS enabled on the five catalog tables');
select is(
  (select count(*) from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where c.oid in ('public.products'::regclass, 'public.product_variants'::regclass, 'public.date_rules'::regclass, 'public.shipping_zones'::regclass, 'public.store_settings'::regclass)
       and has_table_privilege('anon', c.oid, p.priv)),
  0::bigint, 'anon has no table privilege on the catalog tables');
select is(
  (select count(*) from pg_class c cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where c.oid in ('public.products'::regclass, 'public.product_variants'::regclass, 'public.date_rules'::regclass, 'public.shipping_zones'::regclass, 'public.store_settings'::regclass)
       and (has_table_privilege('authenticated', c.oid, p.priv) or has_table_privilege('service_role', c.oid, p.priv))),
  0::bigint, 'authenticated and service_role lack TRUNCATE, REFERENCES and TRIGGER on the catalog tables');
select ok(has_table_privilege('service_role', 'public.products', 'INSERT'), 'service_role can insert products');
select ok(not has_table_privilege('service_role', 'public.products', 'DELETE'), 'service_role cannot delete products');

-- anon
set local role anon;
select throws_ok($$select count(*) from products$$, '42501', null, 'anon cannot read products');
select throws_ok($$select count(*) from store_settings$$, '42501', null, 'anon cannot read store_settings');
select throws_ok($$insert into products (tenant_id, kind, name) values ('10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"x","en":"x"}')$$, '42501', null, 'anon cannot insert products');

-- owner A
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from products), 1::bigint, 'owner A sees only own products');
select is((select count(*) from product_variants), 1::bigint, 'owner A sees only own variants');
select is((select count(*) from date_rules), 1::bigint, 'owner A sees only own date rules');
select is((select count(*) from shipping_zones), 1::bigint, 'owner A sees only own zones');
select is((select count(*) from store_settings), 1::bigint, 'owner A sees only own settings');

select throws_ok($$insert into products (tenant_id, kind, name) values ('10000000-0000-0000-0000-00000000000b', 'simple', '{"es":"x","en":"x"}')$$, '42501', null, 'owner A cannot insert a product for B');
select throws_ok($$insert into product_variants (tenant_id, product_id, label) values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000b', '{"es":"x","en":"x"}')$$, '42501', null, 'owner A cannot insert a variant for B');
select throws_ok($$insert into date_rules (tenant_id, label, kind, value, weekdays) values ('10000000-0000-0000-0000-00000000000b', '{"es":"x","en":"x"}', 'percent', 5, array[1])$$, '42501', null, 'owner A cannot insert a date rule for B');
select throws_ok($$insert into shipping_zones (tenant_id, label, fee_minor) values ('10000000-0000-0000-0000-00000000000b', '{"es":"x","en":"x"}', 5)$$, '42501', null, 'owner A cannot insert a zone for B');
select throws_ok($$insert into store_settings (tenant_id) values ('10000000-0000-0000-0000-00000000000c')$$, '42501', null, 'owner A cannot insert settings for another tenant');

update products set price_minor = 1 where tenant_id = '10000000-0000-0000-0000-00000000000b';
update store_settings set hold_hours = 2 where tenant_id = '10000000-0000-0000-0000-00000000000b';
delete from products where tenant_id = '10000000-0000-0000-0000-00000000000b';
delete from shipping_zones where tenant_id = '10000000-0000-0000-0000-00000000000b';

update products set price_minor = 1500 where id = '20000000-0000-0000-0000-00000000000a';
select is((select price_minor from products where id = '20000000-0000-0000-0000-00000000000a'), 1500, 'owner A updates own product');
insert into products (tenant_id, kind, name) values ('10000000-0000-0000-0000-00000000000a', 'simple', '{"es":"n","en":"n"}');
select is((select count(*) from products), 2::bigint, 'owner A inserts own product');

select throws_ok($$update products set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = '20000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change tenant_id of a product');
select throws_ok($$update store_settings set tenant_id = '10000000-0000-0000-0000-00000000000c'$$, '42501', null, 'owner cannot change tenant_id of settings');
select throws_ok($$update product_variants set tenant_id = '10000000-0000-0000-0000-00000000000b'$$, '42501', null, 'owner cannot change tenant_id of a variant');

-- B rows untouched (checked as superuser)
reset role;
select is((select string_agg(price_minor::text, ',') from products where tenant_id = '10000000-0000-0000-0000-00000000000b'), '2000', 'B product unchanged and not deleted');
select is((select hold_hours from store_settings where tenant_id = '10000000-0000-0000-0000-00000000000b'), 24, 'B settings unchanged');
select is((select count(*) from shipping_zones where tenant_id = '10000000-0000-0000-0000-00000000000b'), 1::bigint, 'B zone not deleted');

-- agency admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
-- counted over this test's own tenants, so rows already in the database do not matter
select is((select count(*) from products
  where tenant_id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b')),
  3::bigint, 'admin sees products of every tenant');
update store_settings set hold_hours = 48 where tenant_id = '10000000-0000-0000-0000-00000000000b';
select is((select hold_hours from store_settings where tenant_id = '10000000-0000-0000-0000-00000000000b'), 48, 'admin updates settings of another tenant');
select throws_ok($$update products set tenant_id = '10000000-0000-0000-0000-00000000000a' where id = '20000000-0000-0000-0000-00000000000b'$$, '42501', null, 'admin cannot change tenant_id of a product either');

select * from finish();
rollback;
