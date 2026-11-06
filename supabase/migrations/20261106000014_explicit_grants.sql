-- Explicit privilege model. Supabase default privileges hand every new public table
-- to anon, authenticated and service_role with ALL privileges; earlier migrations mixed
-- those implicit grants with explicit ones. Here every public table starts from
-- nothing and gets only what is used today: RLS policies still decide which rows
-- authenticated users see, and service_role gets exactly what the stores, the wizard
-- RPCs, the lookup and the seed use. REVOKE ALL also drops column grants, so the
-- column-level grants are restated.
revoke all on public.tenants, public.tenant_domains, public.memberships, public.agency_admins,
  public.client_requests, public.feature_flags, public.feature_flag_audit,
  public.bot_config_versions
  from anon, authenticated, service_role;

-- authenticated: rows filtered by RLS (owners: own tenant; agency admins: all)
grant select, insert, update, delete on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_domains to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;
grant select, insert, update, delete on public.agency_admins to authenticated;
grant select, update, delete on public.client_requests to authenticated;
grant insert (business_name, contact_email, country) on public.client_requests to authenticated;
grant select, delete on public.feature_flags to authenticated;
grant insert (key, rollout), update (rollout) on public.feature_flags to authenticated;
grant select on public.feature_flag_audit to authenticated;
grant select, delete on public.bot_config_versions to authenticated;
grant insert (tenant_id, version, config), update (config) on public.bot_config_versions to authenticated;
revoke truncate, references, trigger on public.tenants, public.tenant_domains, public.memberships, -- allow-unsafe: revokes the TRUNCATE privilege, no data is removed
  public.agency_admins, public.client_requests, public.feature_flags, public.feature_flag_audit,
  public.bot_config_versions from authenticated;

-- anon: only the public signup form fields
grant insert (business_name, contact_email, country) on public.client_requests to anon;

-- service_role
-- tenants: approval creates/deletes, wizard configures/activates, lookup and seed read.
grant select, insert, update, delete on public.tenants to service_role;
-- tenant_domains: lookup reads; the wizard RPCs (security invoker) insert and delete.
grant select, insert, delete on public.tenant_domains to service_role;
-- agency_admins: the seed inserts the first admin (on conflict do nothing).
grant select, insert on public.agency_admins to service_role;
-- client_requests: the approval store reads and moves requests between states.
grant select, update on public.client_requests to service_role;
-- feature_flags: list, and set_feature_flag upserts (security invoker).
grant select, insert, update on public.feature_flags to service_role;
-- feature_flag_audit: append-only through the security definer trigger.
grant select on public.feature_flag_audit to service_role;
revoke insert, update, delete, truncate on public.feature_flag_audit from service_role; -- allow-unsafe: revokes the TRUNCATE privilege, no data is removed
-- bot_config_versions: the bot config RPCs (security invoker) number, insert and publish.
grant select, insert, update on public.bot_config_versions to service_role;

-- Functions service_role calls (directly or from its RPCs), stated explicitly.
grant execute on function public.auth_tenant_id() to service_role;
grant execute on function public.is_agency_admin() to service_role;
grant execute on function public.wizard_set_subdomain(uuid, text) to service_role;
grant execute on function public.wizard_remove_subdomain(uuid, text) to service_role;
grant execute on function public.set_feature_flag(text, text, uuid) to service_role;
grant execute on function public.bot_config_lock(uuid) to service_role;
grant execute on function public.create_bot_config_draft(uuid, jsonb) to service_role;
grant execute on function public.publish_bot_config(uuid, integer) to service_role;
grant execute on function public.rollback_bot_config(uuid) to service_role;

-- The currency CHECK calls this as the writing role.
revoke all on function public.is_currency_code_array(text[]) from public, anon;
grant execute on function public.is_currency_code_array(text[]) to authenticated, service_role;

-- Trigger functions are not meant to be called directly.
revoke all on function public.tenants_guard_protected_columns() from public, anon, authenticated;
