-- The authenticated user always wins as the recorded actor, so a session can never
-- override who is audited via app.changed_by. The service-role RPC path has no
-- sub claim (auth.uid() is null) and still uses the setting.
create or replace function public.audit_feature_flag()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.changed_by', true), '')::uuid);
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
