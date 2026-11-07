begin;
select plan(12);

-- book_slot treats opening-hours rows that touch or overlap as one window (QA D-5).
-- Mondays 2099-03-02 / 03-09 / 03-16 (weekday 1), Tuesday 2099-03-03 (weekday 2),
-- Wednesday 2099-03-04 (weekday 3), America/Tegucigalpa (UTC-6, no DST).
-- The product takes 60 prep + 120 service = 3 h; a pick at S occupies [S - 1 h, S + 2 h).
insert into tenants (id, slug, name, status) values
  ('11000000-0000-0000-0000-00000000000a', 'hours-merge-a', 'Hours merge A', 'active');
insert into store_settings (tenant_id, timezone) values
  ('11000000-0000-0000-0000-00000000000a', 'America/Tegucigalpa');
insert into products (id, tenant_id, kind, reservable, name, price_minor) values
  ('21000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-00000000000a', 'simple', true, '{"es":"Pastel","en":"Cake"}', 1000);
insert into product_calendar (product_id, tenant_id, prep_minutes, service_minutes, buffer_minutes, daily_limit, slot_step_minutes, min_notice_hours, max_days_ahead) values
  ('21000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-00000000000a', 60, 120, 0, null, 30, 0, 36500);
insert into resources (id, tenant_id, name) values
  ('41000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-00000000000a', 'r1'),
  ('41000000-0000-0000-0000-0000000000a2', '11000000-0000-0000-0000-00000000000a', 'r2 own hours');
insert into working_hours (tenant_id, resource_id, weekday, opens, closes) values
  -- Monday: touching rows
  ('11000000-0000-0000-0000-00000000000a', null, 1, '05:00', '08:00'),
  ('11000000-0000-0000-0000-00000000000a', null, 1, '08:00', '20:00'),
  -- Tuesday: a gap between 08:00 and 08:30
  ('11000000-0000-0000-0000-00000000000a', null, 2, '05:00', '08:00'),
  ('11000000-0000-0000-0000-00000000000a', null, 2, '08:30', '20:00'),
  -- Wednesday: r2 has its own overlapping rows; the tenant rows do not apply to it
  ('11000000-0000-0000-0000-00000000000a', '41000000-0000-0000-0000-0000000000a2', 3, '06:00', '09:00'),
  ('11000000-0000-0000-0000-00000000000a', '41000000-0000-0000-0000-0000000000a2', 3, '08:00', '12:00');
insert into orders (id, tenant_id, public_token, status, currency, base_currency, customer_name, customer_phone, subtotal_minor)
select o.id::uuid, '11000000-0000-0000-0000-00000000000a', rpad(replace(o.id, '-', ''), 43, 'y'), 'pending_shipping', 'HNL', 'HNL', 'Test', '+50400000000', 0
  from (values
    ('61000000-0000-0000-0000-000000000001'), ('61000000-0000-0000-0000-000000000002'),
    ('61000000-0000-0000-0000-000000000003'), ('61000000-0000-0000-0000-000000000004'),
    ('61000000-0000-0000-0000-000000000005'), ('61000000-0000-0000-0000-000000000006')) as o(id);

select isnt(
  public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-02 06:30 America/Tegucigalpa', '61000000-0000-0000-0000-000000000001'),
  null, 'a pick whose prep starts in the earlier row and ends in the touching row is booked (06:30: 05:30-08:30)');
select isnt(
  public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-09 07:30 America/Tegucigalpa', '61000000-0000-0000-0000-000000000002'),
  null, 'a 07:30 pick (06:30-09:30) across the boundary is booked');
select isnt(
  public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-16 18:00 America/Tegucigalpa', '61000000-0000-0000-0000-000000000003'),
  null, 'the merged window still ends at 20:00: an 18:00 pick (17:00-20:00) is booked');
select throws_ok($$select public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-16 18:30 America/Tegucigalpa', '61000000-0000-0000-0000-000000000004')$$,
  'P0001', 'outside_hours', 'a booking ending after the merged window closes raises outside_hours (18:30 pick ends 20:30)');
select throws_ok($$select public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-16 05:30 America/Tegucigalpa', '61000000-0000-0000-0000-000000000004')$$,
  'P0001', 'outside_hours', 'a booking whose prep starts before the merged window opens raises outside_hours (05:30 pick needs 04:30)');
select throws_ok($$select public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-03 07:00 America/Tegucigalpa', '61000000-0000-0000-0000-000000000004')$$,
  'P0001', 'outside_hours', 'rows with a gap stay apart: a 07:00 pick (06:00-09:00) over the 08:00-08:30 gap raises outside_hours');
select isnt(
  public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-03 06:00 America/Tegucigalpa', '61000000-0000-0000-0000-000000000004'),
  null, 'a booking inside one row of a split day is still booked (06:00 pick: 05:00-08:00)');
select isnt(
  public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a2', '2099-03-04 08:00 America/Tegucigalpa', '61000000-0000-0000-0000-000000000005'),
  null, 'a resource''s own overlapping rows merge: an 08:00 pick (07:00-10:00) on r2');
select throws_ok($$select public.book_slot('11000000-0000-0000-0000-00000000000a', '21000000-0000-0000-0000-0000000000a1', '41000000-0000-0000-0000-0000000000a1', '2099-03-04 08:00 America/Tegucigalpa', '61000000-0000-0000-0000-000000000006')$$,
  'P0001', 'outside_hours', 'r1 has no Wednesday hours (r2''s rows are its own)');

-- the function keeps its shape: security invoker, empty search_path, service_role only
select is((select prosecdef from pg_proc where oid = 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)'::regprocedure),
  false, 'book_slot stays security invoker');
select is((select proconfig from pg_proc where oid = 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)'::regprocedure),
  array['search_path=""'], 'book_slot keeps an empty search_path');
select is(
  array[has_function_privilege('service_role', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute'),
        has_function_privilege('authenticated', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute'),
        has_function_privilege('anon', 'public.book_slot(uuid, uuid, uuid, timestamptz, uuid)', 'execute')],
  array[true, false, false], 'only service_role may execute book_slot');

select * from finish();
rollback;
