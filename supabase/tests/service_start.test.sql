begin;
select plan(24);

-- The picked time is the start of service (when the team arrives); preparation happens
-- before it, on site. A booking picked at S occupies [S - prep, S + service + buffer).
-- Opening hours must contain [S - prep, S + service]; too_soon is measured against
-- S - prep; too_far and the daily limit use the local day of S.
-- Mondays 2099-03-02 / 03-09 / 03-16 / 03-23 (weekday 1), Tuesday 2099-03-03 (weekday 2),
-- America/Tegucigalpa (UTC-6, no DST).
insert into tenants (id, slug, name, status) values
  ('12000000-0000-0000-0000-00000000000a', 'service-start-a', 'Service start A', 'active');
insert into store_settings (tenant_id, timezone) values
  ('12000000-0000-0000-0000-00000000000a', 'America/Tegucigalpa');
insert into products (id, tenant_id, kind, reservable, name, price_minor) values
  ('22000000-0000-0000-0000-0000000000a1', '12000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Taqueada","en":"Taco party"}', 1000),
  ('22000000-0000-0000-0000-0000000000a2', '12000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Una al día","en":"One a day"}', 1000),
  ('22000000-0000-0000-0000-0000000000a3', '12000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Aviso","en":"Notice"}', 1000),
  ('22000000-0000-0000-0000-0000000000a4', '12000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Margen","en":"Buffer"}', 1000),
  ('22000000-0000-0000-0000-0000000000a5', '12000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Lejos","en":"Far"}', 1000);
insert into product_calendar (product_id, tenant_id, prep_minutes, service_minutes, buffer_minutes, daily_limit, slot_step_minutes, min_notice_hours, max_days_ahead) values
  ('22000000-0000-0000-0000-0000000000a1', '12000000-0000-0000-0000-00000000000a', 60, 120, 0, null, 30, 0, 36500),
  ('22000000-0000-0000-0000-0000000000a2', '12000000-0000-0000-0000-00000000000a', 60, 120, 0, 1, 30, 0, 36500),
  ('22000000-0000-0000-0000-0000000000a3', '12000000-0000-0000-0000-00000000000a', 60, 60, 0, null, 30, 2, 36500),
  ('22000000-0000-0000-0000-0000000000a4', '12000000-0000-0000-0000-00000000000a', 60, 120, 30, null, 30, 0, 36500),
  ('22000000-0000-0000-0000-0000000000a5', '12000000-0000-0000-0000-00000000000a', 60, 120, 0, null, 30, 0, 0);
insert into resources (id, tenant_id, name) values
  ('42000000-0000-0000-0000-0000000000a1', '12000000-0000-0000-0000-00000000000a', 'r1');
insert into working_hours (tenant_id, resource_id, weekday, opens, closes) values
  ('12000000-0000-0000-0000-00000000000a', null, 1, '08:00', '20:00'),
  -- Tuesday: touching rows form one window 05:00-20:00
  ('12000000-0000-0000-0000-00000000000a', null, 2, '05:00', '08:00'),
  ('12000000-0000-0000-0000-00000000000a', null, 2, '08:00', '20:00');
insert into orders (id, tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
select ('62000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, '12000000-0000-0000-0000-00000000000a',
       rpad('62' || lpad(n::text, 2, '0'), 43, 'z'), 'pending_shipping', 'HNL', 'HNL', 'Test', '+50400000000', 0
  from generate_series(1, 20) as n;

set local role service_role;

-- picked 10:00, prep 60 + service 120: occupies 09:00-12:00 local (15:00Z-18:00Z)
select isnt(public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 10:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000001'),
  null, 'a pick at 10:00 is booked');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000001'),
  tstzrange('2099-03-02 09:00 America/Tegucigalpa', '2099-03-02 12:00 America/Tegucigalpa', '[)'),
  'picked 10:00 occupies 09:00-12:00 (prep before the service start)');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000001'),
  tstzrange('2099-03-02 15:00+00', '2099-03-02 18:00+00', '[)'), 'the range is stored in UTC');
-- picked 12:00 occupies 11:00-14:00, which overlaps 09:00-12:00
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 12:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000002')$$,
  'P0001', 'slot_taken', 'a 12:00 pick (prep from 11:00) overlaps the 09:00-12:00 booking');
-- picked 13:00 occupies 12:00-15:00: touches, does not overlap
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 13:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000003')$$,
  'a 13:00 pick (prep from 12:00) is booked right after the first booking');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000003'),
  tstzrange('2099-03-02 12:00 America/Tegucigalpa', '2099-03-02 15:00 America/Tegucigalpa', '[)'),
  'picked 13:00 occupies 12:00-15:00');

-- closing 20:00: the service must end by then
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 18:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000004')$$,
  'a 18:00 pick ends exactly at 20:00 and is booked');
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 18:30 America/Tegucigalpa', '62000000-0000-0000-0000-000000000005')$$,
  'P0001', 'outside_hours', 'an 18:30 pick ends at 20:30, after closing');

-- opening 08:00: preparation must start inside the hours
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-09 08:30 America/Tegucigalpa', '62000000-0000-0000-0000-000000000005')$$,
  'P0001', 'outside_hours', 'an 08:30 pick needs preparation from 07:30, before opening');
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-09 09:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000006')$$,
  'a 09:00 pick prepares from 08:00, at opening, and is booked');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000006'),
  tstzrange('2099-03-09 08:00 America/Tegucigalpa', '2099-03-09 11:00 America/Tegucigalpa', '[)'),
  'picked 09:00 occupies 08:00-11:00');

-- merged hours: preparation may start in the earlier touching row
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-03 06:30 America/Tegucigalpa', '62000000-0000-0000-0000-000000000007')$$,
  'Tuesday 06:30 pick occupies 05:30-08:30 across the touching rows');
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a1', '42000000-0000-0000-0000-0000000000a1', '2099-03-03 05:30 America/Tegucigalpa', '62000000-0000-0000-0000-000000000008')$$,
  'P0001', 'outside_hours', 'Tuesday 05:30 pick needs preparation from 04:30, before the merged window');

-- the buffer still follows the service
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a4', '42000000-0000-0000-0000-0000000000a1', '2099-03-16 10:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000009')$$,
  'a product with a 30 min buffer is booked');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000009'),
  tstzrange('2099-03-16 09:00 America/Tegucigalpa', '2099-03-16 12:30 America/Tegucigalpa', '[)'),
  'picked 10:00 with buffer 30 occupies 09:00-12:30');

-- daily limit (1 a day), counted on the local day of the picked start; release frees it
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a2', '42000000-0000-0000-0000-0000000000a1', '2099-03-23 10:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000010')$$,
  'first of the day');
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a2', '42000000-0000-0000-0000-0000000000a1', '2099-03-23 15:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000011')$$,
  'P0001', 'daily_limit_reached', 'the second of the day raises daily_limit_reached');
select is(public.release_booking('62000000-0000-0000-0000-000000000010'), 1, 'release frees the booking');
select lives_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a2', '42000000-0000-0000-0000-0000000000a1', '2099-03-23 12:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000012')$$,
  'after release, a 12:00 pick (prep from 11:00, overlapping the released range) is booked');
select is((select during from public.bookings where order_id = '62000000-0000-0000-0000-000000000012'),
  tstzrange('2099-03-23 11:00 America/Tegucigalpa', '2099-03-23 14:00 America/Tegucigalpa', '[)'),
  'picked 12:00 occupies 11:00-14:00');

-- min notice counts from when preparation starts; too_far from the picked day
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a3', '42000000-0000-0000-0000-0000000000a1', now() + interval '2 hours 30 minutes', '62000000-0000-0000-0000-000000000013')$$,
  'P0001', 'too_soon', 'a pick 2.5 h ahead with 2 h notice needs preparation 1.5 h ahead: too_soon');
select throws_ok($$select public.book_slot('12000000-0000-0000-0000-00000000000a', '22000000-0000-0000-0000-0000000000a5', '42000000-0000-0000-0000-0000000000a1', '2099-03-02 10:00 America/Tegucigalpa', '62000000-0000-0000-0000-000000000014')$$,
  'P0001', 'too_far', 'beyond max_days_ahead still raises too_far');

-- the function keeps its shape
select is((select proconfig from pg_proc where oid = 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)'::regprocedure),
  array['search_path=""'], 'book_slot keeps an empty search_path');
select is(
  array[has_function_privilege('service_role', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute'),
        has_function_privilege('authenticated', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute'),
        has_function_privilege('anon', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute')],
  array[true, false, false], 'only service_role may execute book_slot');

select * from finish();
rollback;
