-- Versioned bot configuration (prompts and settings) with history and rollback.
-- Owners get no access in this milestone: configs may hold prompts the agency keeps
-- private. Agency admins read/edit drafts through RLS; publication and numbering go
-- through service-role-only functions that serialize per tenant.
create table public.bot_config_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null check (version > 0),
  config jsonb not null
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 262144),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  -- Set on every publication; "previous" for rollback is the archived row published last.
  published_at timestamptz,
  unique (tenant_id, version)
);
create unique index bot_config_one_published_idx
  on public.bot_config_versions (tenant_id) where status = 'published';

alter table public.bot_config_versions enable row level security;
revoke all on public.bot_config_versions from anon, authenticated;
grant select, delete on public.bot_config_versions to authenticated;
grant insert (tenant_id, version, config), update (config) on public.bot_config_versions to authenticated;

create policy bot_config_select on public.bot_config_versions for select to authenticated
  using (public.is_agency_admin());
create policy bot_config_insert on public.bot_config_versions for insert to authenticated
  with check (public.is_agency_admin());
create policy bot_config_update on public.bot_config_versions for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy bot_config_delete on public.bot_config_versions for delete to authenticated
  using (status = 'draft' and public.is_agency_admin());

-- A published or archived version keeps its config forever; only status/published_at move.
create function public.bot_config_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.version is distinct from old.version then
    raise exception 'bot_config_identity_immutable' using errcode = '55000';
  end if;
  if old.status <> 'draft' and new.config is distinct from old.config then
    raise exception 'bot_config_version_immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.bot_config_guard() from public, anon, authenticated;
create trigger bot_config_guard before update on public.bot_config_versions
  for each row execute function public.bot_config_guard();

create function public.bot_config_lock(p_tenant uuid)
returns void
language plpgsql set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('bot_config:' || p_tenant::text, 0));
end;
$$;
revoke all on function public.bot_config_lock(uuid) from public, anon, authenticated;

create function public.create_bot_config_draft(p_tenant uuid, p_config jsonb)
returns integer
language plpgsql set search_path = ''
as $$
declare
  v integer;
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'tenant_not_found' using errcode = 'P0002';
  end if;
  perform public.bot_config_lock(p_tenant);
  select coalesce(max(version), 0) + 1 into v
    from public.bot_config_versions where tenant_id = p_tenant;
  insert into public.bot_config_versions (tenant_id, version, config)
    values (p_tenant, v, p_config);
  return v;
end;
$$;

-- Archives the current published row and publishes the target in one transaction.
-- Publishing the already-published version changes nothing.
create function public.publish_bot_config(p_tenant uuid, p_version integer)
returns void
language plpgsql set search_path = ''
as $$
declare
  target_status text;
begin
  perform public.bot_config_lock(p_tenant);
  select status into target_status from public.bot_config_versions
    where tenant_id = p_tenant and version = p_version;
  if not found then
    raise exception 'bot_config_version_not_found' using errcode = 'P0002';
  end if;
  if target_status = 'published' then
    return;
  end if;
  update public.bot_config_versions set status = 'archived'
    where tenant_id = p_tenant and status = 'published';
  update public.bot_config_versions set status = 'published', published_at = clock_timestamp()
    where tenant_id = p_tenant and version = p_version;
end;
$$;

-- Republishes the version published most recently before the current one.
-- Returns null (and changes nothing) when there is no current or no previous version.
create function public.rollback_bot_config(p_tenant uuid)
returns integer
language plpgsql set search_path = ''
as $$
declare
  prev integer;
begin
  perform public.bot_config_lock(p_tenant);
  if not exists (select 1 from public.bot_config_versions
                 where tenant_id = p_tenant and status = 'published') then
    return null;
  end if;
  select version into prev from public.bot_config_versions
    where tenant_id = p_tenant and status = 'archived' and published_at is not null
    order by published_at desc, version desc limit 1;
  if prev is null then
    return null;
  end if;
  perform public.publish_bot_config(p_tenant, prev);
  return prev;
end;
$$;

revoke all on function public.create_bot_config_draft(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.publish_bot_config(uuid, integer) from public, anon, authenticated;
revoke all on function public.rollback_bot_config(uuid) from public, anon, authenticated;
grant execute on function public.create_bot_config_draft(uuid, jsonb) to service_role;
grant execute on function public.publish_bot_config(uuid, integer) to service_role;
grant execute on function public.rollback_bot_config(uuid) to service_role;
