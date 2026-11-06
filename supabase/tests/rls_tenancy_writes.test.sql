begin;
select plan(13);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'new@test.local');

insert into tenants (id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'suspended', 'general', 'es', 'HNL', array['HNL']),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active', 'general', 'es', 'HNL', array['HNL']);
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into tenant_domains (hostname, tenant_id, kind) values
  ('b.example.test', '10000000-0000-0000-0000-00000000000b', 'subdomain');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

update tenants set name = 'Renamed A' where id = '10000000-0000-0000-0000-00000000000a';
select is((select name from tenants where id = '10000000-0000-0000-0000-00000000000a'), 'Renamed A', 'owner A can rename own tenant');

select throws_ok($$update tenants set status = 'active' where id = '10000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change status');
select throws_ok($$update tenants set cohort = 'pilot' where id = '10000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change cohort');
select throws_ok($$update tenants set slug = 'stolen' where id = '10000000-0000-0000-0000-00000000000a'$$, '42501', null, 'owner cannot change slug');
select is((select status || '/' || cohort || '/' || slug from tenants), 'suspended/general/tenant-a', 'protected columns unchanged');

select throws_ok($$insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1')$$, '42501', null, 'owner cannot insert agency_admins');
select throws_ok($$insert into memberships (user_id, tenant_id, role) values ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000b', 'owner')$$, '42501', null, 'owner cannot insert membership for B');
select throws_ok($$insert into memberships (user_id, tenant_id, role) values ('00000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-00000000000a', 'staff')$$, '42501', null, 'owner cannot insert membership for new user');
update memberships set tenant_id = '10000000-0000-0000-0000-00000000000b' where user_id = '00000000-0000-0000-0000-0000000000a1';
select throws_ok($$insert into tenant_domains (hostname, tenant_id, kind) values ('b.example.test', '10000000-0000-0000-0000-00000000000b', 'custom')$$, '42501', null, 'owner cannot insert domain for B');
select throws_ok($$insert into tenant_domains (hostname, tenant_id, kind) values ('new.example.test', '10000000-0000-0000-0000-00000000000a', 'custom')$$, '42501', null, 'owner cannot insert new domain');
select throws_ok($$insert into tenants (slug, name) values ('c', 'C')$$, '42501', null, 'owner cannot insert tenants');

reset role;
select is((select tenant_id from memberships where user_id = '00000000-0000-0000-0000-0000000000a1'), '10000000-0000-0000-0000-00000000000a'::uuid, 'membership tenant_id unchanged');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
update tenants set status = 'active', cohort = 'pilot' where id = '10000000-0000-0000-0000-00000000000a';
select is((select status || '/' || cohort from tenants where id = '10000000-0000-0000-0000-00000000000a'), 'active/pilot', 'admin can change status and cohort');

select * from finish();
rollback;
