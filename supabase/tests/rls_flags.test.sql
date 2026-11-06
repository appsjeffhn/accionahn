begin;
select plan(28);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into feature_flags (key, rollout) values ('checkout.v2', 'off');

-- constraints (as superuser)
select throws_ok($$insert into feature_flags (key) values ('Bad Key')$$, '23514', null, 'key charset enforced');
select throws_ok($$insert into feature_flags (key) values ('')$$, '23514', null, 'empty key rejected');
select throws_ok($$insert into feature_flags (key) values (repeat('a', 65))$$, '23514', null, 'key over 64 chars rejected');
select throws_ok($$insert into feature_flags (key, rollout) values ('x', 'some')$$, '23514', null, 'rollout enum enforced');

-- atomic set function: creates on first set, audits, no-op without audit
select is(public.set_feature_flag('new.flag', 'pilot', '00000000-0000-0000-0000-0000000000c1'), true, 'first set creates the flag');
select is((select previous from feature_flag_audit where key = 'new.flag'), null, 'creation audit has null previous');
select is(public.set_feature_flag('new.flag', 'pilot', '00000000-0000-0000-0000-0000000000c1'), false, 'same value is a no-op');
select is((select count(*) from feature_flag_audit where key = 'new.flag'), 1::bigint, 'no-op wrote no audit row');
select is(public.set_feature_flag('new.flag', 'off', '00000000-0000-0000-0000-0000000000c1'), true, 'rollback changes value');
select is((select previous || '>' || next from feature_flag_audit where key = 'new.flag' order by id desc limit 1), 'pilot>off', 'audit records previous and next');
select is((select changed_by from feature_flag_audit where key = 'new.flag' order by id desc limit 1), '00000000-0000-0000-0000-0000000000c1'::uuid, 'audit records changed_by');
select throws_ok($$select public.set_feature_flag('BAD', 'off', null)$$, '23514', null, 'function rejects bad key');

-- anon
set local role anon;
select throws_ok($$select count(*) from feature_flags$$, '42501', null, 'anon cannot read flags');
select throws_ok($$select count(*) from feature_flag_audit$$, '42501', null, 'anon cannot read audit');
select throws_ok($$select public.set_feature_flag('x', 'all', null)$$, '42501', null, 'anon cannot call set function');

-- business owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from feature_flags), 2::bigint, 'owner can read flags');
select throws_ok($$insert into feature_flags (key, rollout) values ('owner.flag', 'all')$$, '42501', null, 'owner cannot insert flag');
update feature_flags set rollout = 'all';
reset role;
select is((select string_agg(key || ':' || rollout, ',' order by key) from feature_flags), 'checkout.v2:off,new.flag:off', 'owner update changed nothing (both flags keep original values)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
delete from feature_flags;
reset role;
select is((select string_agg(key || ':' || rollout, ',' order by key) from feature_flags), 'checkout.v2:off,new.flag:off', 'owner delete removed nothing (both flags still exist, unchanged)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from feature_flag_audit), 0::bigint, 'owner reads no audit rows');
select throws_ok($$select public.set_feature_flag('x', 'all', null)$$, '42501', null, 'owner cannot call set function');

-- admin
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
set local app.changed_by = '00000000-0000-0000-0000-0000000000d9';
update feature_flags set rollout = 'all' where key = 'checkout.v2';
select is((select rollout from feature_flags where key = 'checkout.v2'), 'all', 'admin can update flags');
select is((select count(*) from feature_flag_audit where key = 'checkout.v2'), 2::bigint, 'admin can read audit (seed row and update, both audited by trigger)');
delete from feature_flags where key = 'checkout.v2';
select is((select count(*) from feature_flags where key = 'checkout.v2'), 0::bigint, 'admin can delete flags');

reset role;
select is((select changed_by from feature_flag_audit where key = 'checkout.v2' and next = 'all'), '00000000-0000-0000-0000-0000000000c1'::uuid, 'direct admin write records the admin uid even if app.changed_by names someone else');
select is((select count(*) from feature_flag_audit where key = 'checkout.v2' and previous = 'all' and next is null), 1::bigint, 'deleting a flag audits it with next null');

-- service-role RPC path (no sub): the p_changed_by setting is used
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.set_feature_flag('svc.flag', 'all', '00000000-0000-0000-0000-0000000000a1'), true, 'service role can set a flag');
reset role;
select is((select changed_by from feature_flag_audit where key = 'svc.flag'), '00000000-0000-0000-0000-0000000000a1'::uuid, 'service-role path records p_changed_by');

select * from finish();
rollback;
