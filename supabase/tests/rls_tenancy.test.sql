begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');

insert into tenants (id, slug, name, status, default_locale, base_currency, enabled_currencies) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active', 'es', 'HNL', array['HNL']),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active', 'es', 'HNL', array['HNL']);

insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into tenant_domains (hostname, tenant_id, kind) values
  ('a.example.test', '10000000-0000-0000-0000-00000000000a', 'subdomain'),
  ('b.example.test', '10000000-0000-0000-0000-00000000000b', 'subdomain');

-- owner A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select is((select count(*)::int from tenants), 1, 'owner A sees exactly one tenant');
select is((select slug from tenants), 'tenant-a', 'owner A sees tenant A');
select is((select count(*)::int from tenant_domains), 1, 'owner A sees only own domains');

with u as (update tenants set name = 'hacked' where id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from u), 0, 'owner A cannot update tenant B');

with d as (delete from tenants where id = '10000000-0000-0000-0000-00000000000b' returning 1)
select is((select count(*)::int from d), 0, 'owner A cannot delete tenant B');

-- anon
reset role;
set local role anon;
set local request.jwt.claims = '';
select throws_ok('select count(*) from tenants', '42501', null, 'anon has no access to tenants');

-- admin
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
-- counted over this test's own tenants, so rows already in the database do not matter
select is((select count(*)::int from tenants
  where id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b')),
  2, 'agency admin sees both tenants');

-- unique membership (as superuser)
reset role;
select throws_ok(
  $$insert into memberships (user_id, tenant_id, role) values ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000b', 'staff')$$,
  '23505', null, 'second membership for same user violates unique');

select is((select count(*)::int from tenants where name = 'hacked'), 0, 'tenant B untouched');

select * from finish();
rollback;
