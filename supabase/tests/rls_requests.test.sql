begin;
select plan(23);

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into agency_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into tenants (id, slug, name) values ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A');

-- anon
set local role anon;
select lives_ok($$insert into client_requests (business_name, contact_email, country) values ('Tienda Uno', 'uno@test.local', 'HN')$$, 'anon can insert a pending request');
select lives_ok($$insert into client_requests (business_name, contact_email, country) values ('Tienda Dos', 'dos@test.local', 'HN')$$, 'anon can insert with only the allowed columns');
select throws_ok($$insert into client_requests (id, business_name, contact_email, country) values (gen_random_uuid(), 'X', 'x@test.local', 'HN')$$, '42501', null, 'anon cannot set id');
select throws_ok($$insert into client_requests (business_name, contact_email, country, created_at) values ('X', 'x@test.local', 'HN', now() + interval '10 years')$$, '42501', null, 'anon cannot set created_at');
select throws_ok($$insert into client_requests (business_name, contact_email, country, approved_at) values ('X', 'x@test.local', 'HN', now())$$, '42501', null, 'anon cannot set approved_at');
select throws_ok($$insert into client_requests (business_name, contact_email, country, status) values ('X', 'x@test.local', 'HN', 'approved')$$, '42501', null, 'anon cannot insert approved');
select throws_ok($$insert into client_requests (business_name, contact_email, country, tenant_id) values ('X', 'x@test.local', 'HN', '10000000-0000-0000-0000-00000000000a')$$, '42501', null, 'anon cannot insert with tenant_id');
select throws_ok($$select count(*) from client_requests$$, '42501', null, 'anon cannot read');
select throws_ok($$update client_requests set status = 'approved'$$, '42501', null, 'anon cannot update');
select throws_ok($$delete from client_requests$$, '42501', null, 'anon cannot delete');
select throws_ok($$insert into client_requests (business_name, contact_email, country) values (repeat('a', 201), 'x@test.local', 'HN')$$, '23514', null, 'business_name too long rejected');
select throws_ok($$insert into client_requests (business_name, contact_email, country) values ('X', 'not-an-email', 'HN')$$, '23514', null, 'bad email rejected');
select throws_ok($$insert into client_requests (business_name, contact_email, country) values ('X', 'x@test.local', repeat('a', 101))$$, '23514', null, 'country too long rejected');

-- authenticated non-admin
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$insert into client_requests (business_name, contact_email, country) values ('Tienda Tres', 'tres@test.local', 'SV')$$, 'authenticated can insert pending');
select throws_ok($$insert into client_requests (business_name, contact_email, country, status) values ('X', 'x@test.local', 'HN', 'rejected')$$, '42501', null, 'authenticated cannot insert rejected');
select throws_ok($$insert into client_requests (business_name, contact_email, country, created_at) values ('X', 'x@test.local', 'HN', now())$$, '42501', null, 'authenticated cannot set created_at');
select is((select count(*) from client_requests), 0::bigint, 'non-admin reads nothing');
update client_requests set status = 'approved';
delete from client_requests;

-- admin
reset role;
select is((select count(*) from client_requests where status = 'pending'), 3::bigint, 'non-admin update/delete changed nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is((select count(*) from client_requests), 3::bigint, 'admin reads all');
update client_requests set status = 'approved', tenant_id = '10000000-0000-0000-0000-00000000000a' where business_name = 'Tienda Uno';
select is((select status from client_requests where business_name = 'Tienda Uno'), 'approved', 'admin can update');
update client_requests set status = 'rejected' where business_name = 'Tienda Dos';
select is((select status from client_requests where business_name = 'Tienda Dos'), 'rejected', 'admin can reject');
delete from client_requests where business_name = 'Tienda Tres';
select is((select count(*) from client_requests), 2::bigint, 'admin can delete');
select throws_ok($$update client_requests set status = 'bogus'$$, '23514', null, 'status check enforced');

select * from finish();
rollback;
