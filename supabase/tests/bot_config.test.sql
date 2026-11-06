begin;
select plan(31);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');

-- drafts: distinct consecutive versions per tenant
select is(public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '{"p":1}'), 1, 'first draft is version 1');
select is(public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '{"p":2}'), 2, 'second draft is version 2');
select is(public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '{"p":3}'), 3, 'third draft is version 3');
select is(public.create_bot_config_draft('10000000-0000-0000-0000-00000000000b', '{"p":1}'), 1, 'numbering is per tenant');
select throws_ok($$select public.create_bot_config_draft('10000000-0000-0000-0000-0000000000ff', '{}')$$, 'P0002', 'tenant_not_found', 'draft for unknown tenant raises typed error');

-- config validation
select throws_ok($$select public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '[1]')$$, '23514', null, 'array config rejected');
select throws_ok($$select public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '"x"')$$, '23514', null, 'scalar config rejected');
select throws_ok($$select public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', jsonb_build_object('big', repeat('x', 262200)))$$, '23514', null, 'config over 256 KB rejected');
select is((select max(version) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a'), 3, 'rejected drafts did not consume versions');

-- rollback with nothing published
select is(public.rollback_bot_config('10000000-0000-0000-0000-00000000000a'), null, 'rollback with nothing published returns null');

-- publish: unknown version raises, publish 1
select throws_ok($$select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 99)$$, 'P0002', 'bot_config_version_not_found', 'publish unknown version raises typed error');
select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 1);
select is((select string_agg(version || ':' || status, ',' order by version) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a'), '1:published,2:draft,3:draft', 'publish 1');

-- rollback with a single publication in history returns null and changes nothing
select is(public.rollback_bot_config('10000000-0000-0000-0000-00000000000a'), null, 'rollback with one published version returns null');
select is((select string_agg(version || ':' || status, ',' order by version) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a'), '1:published,2:draft,3:draft', 'rollback with one version changed nothing');

-- publishing the already-published version is a no-op
select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 1);
select is((select count(*) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a' and status = 'published'), 1::bigint, 're-publish of published keeps exactly one published');

-- publish 2 archives 1 (clock_timestamp is used for published_at, so order is strict)
select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 2);
select is((select string_agg(version || ':' || status, ',' order by version) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a'), '1:archived,2:published,3:draft', 'publish 2 archives 1');
select is((select status from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000b'), 'draft', 'other tenant untouched');

-- the partial unique index itself rejects a second published row
select throws_ok($$update bot_config_versions set status = 'published' where tenant_id = '10000000-0000-0000-0000-00000000000a' and version = 3$$, '23505', null, 'index allows a single published row per tenant');

-- rollback republishes 1
select is(public.rollback_bot_config('10000000-0000-0000-0000-00000000000a'), 1, 'rollback returns previous version');
select is((select string_agg(version || ':' || status, ',' order by version) from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a'), '1:published,2:archived,3:draft', 'rollback leaves 1 published');

-- archived versions can be republished
select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 2);
select is((select version from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a' and status = 'published'), 2, 'archived version republished');

-- immutability
select throws_ok($$update bot_config_versions set config = '{"x":1}' where tenant_id = '10000000-0000-0000-0000-00000000000a' and version = 2$$, '55000', null, 'published config is immutable');
select throws_ok($$update bot_config_versions set config = '{"x":1}' where tenant_id = '10000000-0000-0000-0000-00000000000a' and version = 1$$, '55000', null, 'archived config is immutable');
update bot_config_versions set config = '{"edited":true}' where tenant_id = '10000000-0000-0000-0000-00000000000a' and version = 3;
select is((select config->>'edited' from bot_config_versions where tenant_id = '10000000-0000-0000-0000-00000000000a' and version = 3), 'true', 'draft config stays editable');

-- anon
set local role anon;
select throws_ok($$select count(*) from bot_config_versions$$, '42501', null, 'anon cannot read versions');
select throws_ok($$select public.create_bot_config_draft('10000000-0000-0000-0000-00000000000a', '{}')$$, '42501', null, 'anon cannot call draft function');

-- business owner: no access at all in this milestone
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from bot_config_versions), 0::bigint, 'owner reads no versions, not even own tenant');
select throws_ok($$insert into bot_config_versions (tenant_id, version, config) values ('10000000-0000-0000-0000-00000000000a', 50, '{}')$$, '42501', null, 'owner cannot insert versions');
select throws_ok($$select public.publish_bot_config('10000000-0000-0000-0000-00000000000a', 3)$$, '42501', null, 'owner cannot call publish function');

-- admin
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*) from bot_config_versions), 4::bigint, 'admin reads all versions');
select lives_ok($$insert into bot_config_versions (tenant_id, version, config) values ('10000000-0000-0000-0000-00000000000a', 50, '{}')$$, 'admin can insert a draft');

select * from finish();
rollback;
