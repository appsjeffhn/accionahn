begin;
select plan(64);

-- Day under test: Monday 2099-03-02 (weekday 1) in America/Tegucigalpa (UTC-6, no DST).
-- Tuesday 2099-03-03 is a tenant-wide closed date; Wednesday 2099-03-04 has no hours.
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@test.local');
insert into tenants (id, slug, name, status) values
  ('10000000-0000-0000-0000-00000000000a', 'tenant-a', 'Tenant A', 'active'),
  ('10000000-0000-0000-0000-00000000000b', 'tenant-b', 'Tenant B', 'active');
insert into memberships (user_id, tenant_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'owner');
insert into store_settings (tenant_id, timezone) values
  ('10000000-0000-0000-0000-00000000000a', 'America/Tegucigalpa'),
  ('10000000-0000-0000-0000-00000000000b', 'America/Tegucigalpa');
insert into products (id, tenant_id, kind, reservable, name, price_minor) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Pastel","en":"Cake"}', 1000),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Corto","en":"Short"}', 1000),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Aviso","en":"Notice"}', 1000),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Solo r1","en":"r1 only"}', 1000),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"r3","en":"r3"}', 1000),
  ('20000000-0000-0000-0000-0000000000a6', '10000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Sin agenda","en":"No calendar"}', 1000),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'simple', true, '{"es":"B","en":"B"}', 1000);
-- a1: Spezia-like cake, 60 prep + 120 service, at most 2 a day.
insert into product_calendar (product_id, tenant_id, prep_minutes, service_minutes, buffer_minutes, daily_limit, slot_step_minutes, min_notice_hours, max_days_ahead) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 60, 120, 0, 2, 30, 0, 36500),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 0, 60, 0, null, 30, 0, 36500),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 0, 60, 0, null, 30, 48, 180),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000a', 0, 60, 0, null, 30, 0, 36500),
  ('20000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-00000000000a', 0, 60, 0, null, 30, 0, 36500),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 0, 120, 0, null, 30, 0, 36500);
-- r1 serves everything (no resource_services rows); r2 only a2; r3 only a5 with its own hours.
insert into resources (id, tenant_id, name) values
  ('40000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'r1'),
  ('40000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'r2'),
  ('40000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-00000000000a', 'r3');
insert into resource_services (tenant_id, resource_id, product_id) values
  ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a2'),
  ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-0000000000a5');
insert into working_hours (tenant_id, resource_id, weekday, opens, closes) values
  ('10000000-0000-0000-0000-00000000000a', null, 1, '08:00', '20:00'),
  ('10000000-0000-0000-0000-00000000000a', null, 2, '08:00', '20:00'),
  ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a3', 1, '08:00', '10:00'),
  ('10000000-0000-0000-0000-00000000000b', null, 1, '08:00', '20:00');
insert into closed_dates (tenant_id, resource_id, day, reason) values
  ('10000000-0000-0000-0000-00000000000a', null, '2099-03-03', 'Feriado');

-- shape and same-tenant constraints
select throws_ok($$insert into working_hours (tenant_id, weekday, opens, closes) values ('10000000-0000-0000-0000-00000000000a', 7, '08:00', '09:00')$$, '23514', null, 'weekday must be 0..6');
select throws_ok($$insert into working_hours (tenant_id, weekday, opens, closes) values ('10000000-0000-0000-0000-00000000000a', 1, '10:00', '09:00')$$, '23514', null, 'opens must be before closes');
select throws_ok($$insert into resource_services (tenant_id, resource_id, product_id) values ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000b1')$$, '23503', null, 'resource_services cannot link a product of another tenant');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, during, status) values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000a1', tstzrange('2099-03-02 08:00 America/Tegucigalpa', '2099-03-02 09:00 America/Tegucigalpa'), 'held')$$, '23503', null, 'a booking cannot use a resource of another tenant');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, during, status) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', tstzrange('2099-03-02 08:00 America/Tegucigalpa', '2099-03-02 09:00 America/Tegucigalpa'), 'lost')$$, '23514', null, 'booking status must be known');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, during, status) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', tstzrange('2099-03-02 08:00 America/Tegucigalpa', '2099-03-02 08:00 America/Tegucigalpa'), 'held')$$, '23514', null, 'a booking range cannot be empty');

set local role service_role;

-- overlap on one resource
select isnt(public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 09:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000001'), null, 'first booking returns an id');
select is((select during from bookings where order_id = '60000000-0000-0000-0000-000000000001'), tstzrange('2099-03-02 15:00+00', '2099-03-02 18:00+00'), 'booking occupies prep + service, stored in UTC');
select is((select status from bookings where order_id = '60000000-0000-0000-0000-000000000001'), 'held', 'a new booking is held');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 11:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000002')$$, 'P0001', 'slot_taken', 'an overlapping booking on the same resource raises slot_taken');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, order_id, during, status) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000000002', tstzrange('2099-03-02 11:00 America/Tegucigalpa', '2099-03-02 12:30 America/Tegucigalpa'), 'held')$$, '23P01', null, 'the exclusion constraint rejects a direct overlapping insert');
select is((select count(*) from bookings where order_id = '60000000-0000-0000-0000-000000000002'), 0::bigint, 'failed bookings leave no row');
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 12:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000003')$$, 'a contiguous booking (starts when the previous ends) is accepted');

-- daily limit (a1: 2 a day)
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 14:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000004')$$, 'second cake of the day');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 17:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000005')$$, 'P0001', 'daily_limit_reached', 'the third cake of the day raises daily_limit_reached');

-- release frees the slot and the daily count
select is(public.release_booking('60000000-0000-0000-0000-000000000001'), 1, 'release reports one booking released');
select is((select status from bookings where order_id = '60000000-0000-0000-0000-000000000001'), 'released', 'the booking is released');
select is(public.release_booking('60000000-0000-0000-0000-000000000001'), 0, 'a second release changes nothing');
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 09:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000006')$$, 'the released slot can be booked again');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 17:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000005')$$, 'P0001', 'daily_limit_reached', 'the limit counts the new booking again');

-- confirm
select is(public.confirm_booking('60000000-0000-0000-0000-000000000004'), 1, 'confirm reports one booking confirmed');
select is((select status from bookings where order_id = '60000000-0000-0000-0000-000000000004'), 'confirmed', 'the booking is confirmed');
select is(public.confirm_booking('60000000-0000-0000-0000-000000000004'), 0, 'a second confirm changes nothing');
select is(public.confirm_booking('60000000-0000-0000-0000-000000000001'), 0, 'a released booking cannot be confirmed');

-- opening hours and closed dates
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 19:30 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'outside_hours', 'a booking ending after closing raises outside_hours');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 07:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'outside_hours', 'a booking starting before opening raises outside_hours');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-04 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'outside_hours', 'a weekday without hours raises outside_hours');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-03 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'closed_date', 'a closed date raises closed_date');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a5', '40000000-0000-0000-0000-0000000000a3', '2099-03-02 11:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'outside_hours', 'resource hours replace the tenant hours');
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a5', '40000000-0000-0000-0000-0000000000a3', '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000011')$$, 'a booking inside the resource hours is accepted');
-- a closed date for one resource only closes that resource
reset role;
insert into closed_dates (tenant_id, resource_id, day, reason) values
  ('10000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-0000000000a2', '2099-03-02', 'r2 off');
set local role service_role;
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a2', '2099-03-02 18:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000010')$$, 'P0001', 'closed_date', 'a resource closed that day raises closed_date');
reset role;
delete from closed_dates where resource_id = '40000000-0000-0000-0000-0000000000a2';
set local role service_role;

-- "any available": r1 is busy 14:00-17:00 (order 4); r2 serves a2 and is free
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-02 15:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000020')$$, 'any available books when one resource is free');
select is((select resource_id from bookings where order_id = '60000000-0000-0000-0000-000000000020'), '40000000-0000-0000-0000-0000000000a2'::uuid, 'any available assigns the free resource');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-02 15:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000021')$$, 'P0001', 'slot_taken', 'any available raises slot_taken when every resource is busy');
-- a4 is served only by r1 (r2 and r3 have services that exclude it)
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a4', null, '2099-03-02 15:30 America/Tegucigalpa', '60000000-0000-0000-0000-000000000022')$$, 'P0001', 'slot_taken', 'a free resource that does not offer the service is not assigned');
-- 18:00: r1 (3 live bookings) and r2 (1) are both free; the one with fewer bookings wins
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-02 18:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000023')$$, 'any available at 18:00');
select is((select resource_id from bookings where order_id = '60000000-0000-0000-0000-000000000023'), '40000000-0000-0000-0000-0000000000a2'::uuid, 'any available picks the resource with the fewest bookings that day');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-0000000000a2', '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000024')$$, '22023', null, 'an explicit resource that does not offer the service is refused');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-04 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000025')$$, 'P0001', 'outside_hours', 'any available outside hours raises outside_hours');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-03 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000025')$$, 'P0001', 'closed_date', 'any available on a closed date raises closed_date');

-- notice window
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-0000000000a1', now() + interval '1 hour', '60000000-0000-0000-0000-000000000030')$$, 'P0001', 'too_soon', 'less than min_notice_hours ahead raises too_soon');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', now() - interval '1 day', '60000000-0000-0000-0000-000000000030')$$, 'P0001', 'too_soon', 'a start in the past raises too_soon');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000030')$$, 'P0001', 'too_far', 'beyond max_days_ahead raises too_far');

-- bad input and tenant isolation
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 08:00 America/Tegucigalpa', null)$$, '22023', null, 'an order id is required');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a6', null, '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000031')$$, 'P0001', 'not_bookable', 'a product without calendar settings raises not_bookable');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000b1', null, '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000031')$$, '42501', null, 'a product of another tenant raises 42501');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '40000000-0000-0000-0000-0000000000a1', '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000031')$$, '42501', null, 'a resource of another tenant raises 42501');

-- implicit default resource: tenant B defines none
select is((select count(*) from resources where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'tenant B starts without resources');
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', null, '2099-03-02 10:00 America/Tegucigalpa', '60000000-0000-0000-0000-0000000000b1')$$, 'a tenant without resources can book');
select is((select count(*) from resources where tenant_id = '10000000-0000-0000-0000-00000000000b' and is_default), 1::bigint, 'the default resource is created lazily');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', null, '2099-03-02 11:00 America/Tegucigalpa', '60000000-0000-0000-0000-0000000000b2')$$, 'P0001', 'slot_taken', 'the default resource cannot be double booked');
select lives_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', null, '2099-03-02 12:00 America/Tegucigalpa', '60000000-0000-0000-0000-0000000000b3')$$, 'a later slot on the default resource works');
select is((select count(*) from resources where tenant_id = '10000000-0000-0000-0000-00000000000b'), 1::bigint, 'only one default resource is ever created');

-- service_role privileges stay minimal
select throws_ok($$delete from bookings$$, '42501', null, 'service_role cannot delete bookings');
select throws_ok($$update bookings set during = tstzrange('2099-03-02 08:00+00', '2099-03-02 09:00+00')$$, '42501', null, 'service_role cannot move a booking');

-- owners: CRUD on their own calendar setup, read-only bookings, no functions
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*) from bookings where tenant_id = '10000000-0000-0000-0000-00000000000a') > 0, true, 'owner A sees tenant A bookings');
select is((select count(*) from bookings where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B bookings');
select throws_ok($$insert into bookings (tenant_id, product_id, resource_id, during, status) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-0000000000a1', tstzrange('2099-03-02 19:00 America/Tegucigalpa', '2099-03-02 19:30 America/Tegucigalpa'), 'held')$$, '42501', null, 'owner cannot insert bookings');
select lives_ok($$insert into working_hours (tenant_id, weekday, opens, closes) values ('10000000-0000-0000-0000-00000000000a', 3, '09:00', '17:00')$$, 'owner adds working hours to their tenant');
select throws_ok($$insert into working_hours (tenant_id, weekday, opens, closes) values ('10000000-0000-0000-0000-00000000000b', 3, '09:00', '17:00')$$, '42501', null, 'owner cannot add hours to another tenant');
select lives_ok($$update product_calendar set daily_limit = 3 where product_id = '20000000-0000-0000-0000-0000000000a1'$$, 'owner updates their product calendar');
select is((select count(*) from resources where tenant_id = '10000000-0000-0000-0000-00000000000b'), 0::bigint, 'owner A sees no tenant B resources');
select throws_ok($$select public.book_slot('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a2', null, '2099-03-02 08:00 America/Tegucigalpa', '60000000-0000-0000-0000-000000000040')$$, '42501', null, 'owner cannot call book_slot');
reset role;
set local role anon;
select throws_ok($$select count(*) from resources$$, '42501', null, 'anon cannot read resources');

select * from finish();
rollback;
