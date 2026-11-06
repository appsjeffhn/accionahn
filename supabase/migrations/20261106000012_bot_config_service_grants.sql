-- The RPCs are SECURITY INVOKER, so service_role needs every privilege they touch
-- explicitly, not through Supabase default privileges.
grant execute on function public.bot_config_lock(uuid) to service_role;
grant select on public.tenants to service_role;
grant select, insert, update on public.bot_config_versions to service_role;

comment on function public.rollback_bot_config(uuid) is
  'Republishes the version published most recently before the current one (archived row with the latest published_at). Repeated rollback therefore toggles between the two most recent publications. Returns null, changing nothing, when nothing is published or there is no previous publication.';
