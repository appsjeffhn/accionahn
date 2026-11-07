-- approved_at marks when a request was claimed for approval, so a claim that never
-- produced a tenant (crash, failed link) can be detected as stale and retried.
alter table public.client_requests add column approved_at timestamptz;

-- Public submitters may only supply the three form fields; id, created_at, status,
-- tenant_id and approved_at always take their defaults.
revoke insert on public.client_requests from anon, authenticated;
grant insert (business_name, contact_email, country) on public.client_requests to anon, authenticated;
