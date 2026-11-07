-- Release flags by cohort. Signed-in users may read the rollout state; only agency
-- admins may change it. Every change is audited by a trigger, so a flag cannot change
-- without its audit row (same statement, same transaction) whatever the write path.
create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.-]{1,64}$'),
  rollout text not null default 'off' check (rollout in ('off','pilot','all'))
);

create table public.feature_flag_audit (
  id bigint generated always as identity primary key,
  key text not null,
  previous text check (previous in ('off','pilot','all')),
  next text check (next in ('off','pilot','all')),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index feature_flag_audit_key_idx on public.feature_flag_audit(key, id desc);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_audit enable row level security;

revoke all on public.feature_flags from anon, authenticated;
revoke all on public.feature_flag_audit from anon, authenticated;
grant select on public.feature_flags to authenticated;
grant insert (key, rollout), update (rollout), delete on public.feature_flags to authenticated;
-- The audit table is append-only through the trigger: admins can read, nobody writes directly.
grant select on public.feature_flag_audit to authenticated;

create policy feature_flags_read on public.feature_flags for select to authenticated
  using (true);
create policy feature_flags_insert on public.feature_flags for insert to authenticated
  with check (public.is_agency_admin());
create policy feature_flags_update on public.feature_flags for update to authenticated
  using (public.is_agency_admin()) with check (public.is_agency_admin());
create policy feature_flags_delete on public.feature_flags for delete to authenticated
  using (public.is_agency_admin());
create policy feature_flag_audit_read on public.feature_flag_audit for select to authenticated
  using (public.is_agency_admin());

create function public.audit_feature_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := coalesce(nullif(current_setting('app.changed_by', true), '')::uuid, auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.feature_flag_audit (key, previous, next, changed_by)
      values (new.key, null, new.rollout, actor);
  elsif tg_op = 'UPDATE' then
    insert into public.feature_flag_audit (key, previous, next, changed_by)
      values (new.key, old.rollout, new.rollout, actor);
  else
    insert into public.feature_flag_audit (key, previous, next, changed_by)
      values (old.key, old.rollout, null, actor);
  end if;
  return null;
end;
$$;
revoke all on function public.audit_feature_flag() from public, anon, authenticated;

create trigger feature_flags_audit_ins after insert or delete on public.feature_flags
  for each row execute function public.audit_feature_flag();
-- Updates audit only a real change of rollout, so a no-op write leaves no misleading row.
create trigger feature_flags_audit_upd after update on public.feature_flags
  for each row when (old.rollout is distinct from new.rollout)
  execute function public.audit_feature_flag();

-- Used by the service-role store. Creates the flag on first set. One upsert statement:
-- returns true if it created or changed the flag, false for a no-op (nothing audited).
create function public.set_feature_flag(p_key text, p_next text, p_changed_by uuid)
returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  n integer;
begin
  perform set_config('app.changed_by', coalesce(p_changed_by::text, ''), true);
  insert into public.feature_flags (key, rollout) values (p_key, p_next)
    on conflict (key) do update set rollout = excluded.rollout
    where public.feature_flags.rollout is distinct from excluded.rollout;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.set_feature_flag(text, text, uuid) from public, anon, authenticated;
grant execute on function public.set_feature_flag(text, text, uuid) to service_role;
