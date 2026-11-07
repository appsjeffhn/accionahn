begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');

insert into tenants (id, slug, name, status, cohort, default_locale, base_currency, enabled_currencies, settings) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active', 'general', 'es', 'HNL', array['HNL','USD'],
   '{"ownerAlertPhone":"+50400000000","extraCurrencies":[],"orderFields":[],"whatsappMode":"evolution","aiCapCents":500,"retentionMonths":12}');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');

-- currency format constraints (as superuser, so only the CHECK can reject)
select throws_ok($$update tenants set base_currency = 'XXX1' where slug = 'tenant-a'$$, '23514', null, 'base_currency XXX1 rejected');
select throws_ok($$update tenants set base_currency = 'xxx' where slug = 'tenant-a'$$, '23514', null, 'lowercase base_currency rejected');
select throws_ok($$update tenants set enabled_currencies = array['HNL','usd'] where slug = 'tenant-a'$$, '23514', null, 'lowercase enabled currency rejected');
select throws_ok($$update tenants set enabled_currencies = array['HNL','US,D'] where slug = 'tenant-a'$$, '23514', null, 'malformed enabled currency rejected');
select throws_ok($$update tenants set enabled_currencies = array['HNL',null] where slug = 'tenant-a'$$, '23514', null, 'null enabled currency rejected');

-- business owner
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$update tenants set settings = settings || '{"aiCapCents":99999}' where slug = 'tenant-a'$$, '42501', null, 'owner cannot raise aiCapCents');
select throws_ok($$update tenants set settings = settings || '{"whatsappMode":"cloud_api"}' where slug = 'tenant-a'$$, '42501', null, 'owner cannot change whatsappMode');
select throws_ok($$update tenants set settings = settings || '{"retentionMonths":120}' where slug = 'tenant-a'$$, '42501', null, 'owner cannot change retentionMonths');
select throws_ok($$update tenants set settings = settings - 'aiCapCents' where slug = 'tenant-a'$$, '42501', null, 'owner cannot remove aiCapCents');
select throws_ok($$update tenants set settings = '{"ownerAlertPhone":"+50411111111"}' where slug = 'tenant-a'$$, '42501', null, 'owner cannot replace settings dropping agency keys');
select throws_ok($$update tenants set base_currency = 'XXX1' where slug = 'tenant-a'$$, '23514', null, 'owner cannot set base_currency XXX1');
select throws_ok($$update tenants set base_currency = 'xxx' where slug = 'tenant-a'$$, '23514', null, 'owner cannot set base_currency xxx');

update tenants set settings = settings || '{"ownerAlertPhone":"+50499999999"}' where slug = 'tenant-a';

reset role;
select is(
  (select settings->>'aiCapCents' || '/' || (settings->>'whatsappMode') || '/' || (settings->>'retentionMonths') from tenants where slug = 'tenant-a'),
  '500/evolution/12', 'agency-only settings unchanged after owner attempts');
select is((select settings->>'ownerAlertPhone' from tenants where slug = 'tenant-a'), '+50499999999', 'owner can change the alert phone');
select is((select base_currency from tenants where slug = 'tenant-a'), 'HNL', 'base_currency unchanged');

-- agency admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
update tenants set settings = settings || '{"aiCapCents":800}' where slug = 'tenant-a';
reset role;
select is((select (settings->>'aiCapCents')::int from tenants where slug = 'tenant-a'), 800, 'agency admin can change the AI cap');

-- service role (wizard store path: no JWT user)
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
update tenants set settings = settings || '{"aiCapCents":700,"retentionMonths":6}' where slug = 'tenant-a';
reset role;
select is((select settings->>'aiCapCents' || '/' || (settings->>'retentionMonths') from tenants where slug = 'tenant-a'), '700/6', 'service_role can change agency-only settings');

select * from finish();
rollback;
