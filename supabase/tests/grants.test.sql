begin;
select plan(31);

-- authenticated never gets TRUNCATE, REFERENCES or TRIGGER on any public table
select ok(not has_table_privilege('authenticated', 'public.tenants', 'TRUNCATE'), 'authenticated lacks TRUNCATE on tenants');
select ok(not has_table_privilege('authenticated', 'public.tenant_domains', 'TRUNCATE'), 'authenticated lacks TRUNCATE on tenant_domains');
select ok(not has_table_privilege('authenticated', 'public.memberships', 'TRUNCATE'), 'authenticated lacks TRUNCATE on memberships');
select ok(not has_table_privilege('authenticated', 'public.agency_admins', 'TRUNCATE'), 'authenticated lacks TRUNCATE on agency_admins');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('authenticated', c.oid, p.priv)),
  0::bigint, 'authenticated has no TRUNCATE, REFERENCES or TRIGGER on any public table');
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
     where n.nspname = 'public' and c.relkind = 'r'
       and has_table_privilege('anon', c.oid, p.priv)),
  0::bigint, 'anon has no table-level privilege on any public table');
select ok(has_column_privilege('anon', 'public.client_requests', 'business_name', 'INSERT'), 'anon can still submit a client request');

-- feature_flag_audit is append-only through the trigger
select ok(not has_table_privilege('service_role', 'public.feature_flag_audit', 'UPDATE'), 'service_role lacks UPDATE on feature_flag_audit');
select ok(not has_table_privilege('service_role', 'public.feature_flag_audit', 'DELETE'), 'service_role lacks DELETE on feature_flag_audit');
select ok(not has_table_privilege('service_role', 'public.feature_flag_audit', 'TRUNCATE'), 'service_role lacks TRUNCATE on feature_flag_audit');
select ok(not has_table_privilege('service_role', 'public.feature_flag_audit', 'INSERT'), 'service_role lacks direct INSERT on feature_flag_audit');
select ok(not has_table_privilege('service_role', 'public.feature_flags', 'TRUNCATE'), 'service_role lacks TRUNCATE on feature_flags (unaudited)');

-- service_role functions are granted explicitly
select ok(has_function_privilege('service_role', 'public.wizard_set_subdomain(uuid, text)', 'EXECUTE'), 'service_role may run wizard_set_subdomain');
select ok(has_function_privilege('service_role', 'public.wizard_remove_subdomain(uuid, text)', 'EXECUTE'), 'service_role may run wizard_remove_subdomain');
select ok(has_function_privilege('service_role', 'public.set_feature_flag(text, text, uuid)', 'EXECUTE'), 'service_role may run set_feature_flag');
select ok(has_function_privilege('service_role', 'public.create_bot_config_draft(uuid, jsonb)', 'EXECUTE'), 'service_role may run create_bot_config_draft');

-- the service-role stores' operations still work end to end
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into client_requests (id, business_name, contact_email, country) values
  ('20000000-0000-0000-0000-000000000001', 'Biz', 'biz@test.local', 'HN');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

select lives_ok($$insert into tenants (id, name, slug, status) values ('10000000-0000-0000-0000-00000000000e', 'E', 'tenant-e', 'pending')$$, 'service_role inserts a tenant');
select lives_ok($$update client_requests set status = 'approved', approved_at = now() where id = '20000000-0000-0000-0000-000000000001'$$, 'service_role claims a request');
select lives_ok($$update client_requests set tenant_id = '10000000-0000-0000-0000-00000000000e' where id = '20000000-0000-0000-0000-000000000001'$$, 'service_role links the tenant');
select lives_ok($$update tenants set slug = 'tenant-e2', settings = '{"aiCapCents":500}', base_currency = 'USD', enabled_currencies = array['USD'] where id = '10000000-0000-0000-0000-00000000000e'$$, 'service_role configures the tenant (wizard)');
select lives_ok($$select public.wizard_set_subdomain('10000000-0000-0000-0000-00000000000e', 'tenant-e2.example.test')$$, 'service_role runs wizard_set_subdomain');
select is((select t.slug from tenant_domains d join tenants t on t.id = d.tenant_id where d.hostname = 'tenant-e2.example.test'), 'tenant-e2', 'service_role reads tenant by hostname (lookup)');
select lives_ok($$select public.wizard_remove_subdomain('10000000-0000-0000-0000-00000000000e', 'tenant-e2.example.test')$$, 'service_role runs wizard_remove_subdomain');
select lives_ok($$update tenants set status = 'active' where id = '10000000-0000-0000-0000-00000000000e'$$, 'service_role activates the tenant');
select is(public.set_feature_flag('grants.flag', 'pilot', '00000000-0000-0000-0000-0000000000c1'), true, 'service_role runs set_feature_flag');
select is((select count(*) from feature_flag_audit where key = 'grants.flag'), 1::bigint, 'service_role reads the audit row written by the trigger');
select is(public.create_bot_config_draft('10000000-0000-0000-0000-00000000000e', '{"n":1}'), 1, 'service_role runs create_bot_config_draft');
select lives_ok($$select public.publish_bot_config('10000000-0000-0000-0000-00000000000e', 1)$$, 'service_role runs publish_bot_config');
select is(public.rollback_bot_config('10000000-0000-0000-0000-00000000000e'), null, 'service_role runs rollback_bot_config');
select lives_ok($$insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1') on conflict (user_id) do nothing$$, 'service_role upserts an agency admin (seed)');
select lives_ok($$delete from tenants where id = '10000000-0000-0000-0000-00000000000e'$$, 'service_role deletes a tenant (approval compensation)');

select * from finish();
rollback;
