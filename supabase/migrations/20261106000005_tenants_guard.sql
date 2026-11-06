-- Owners may edit their tenant row, but only agency admins may change
-- identity and lifecycle columns. A trigger is used because admins and
-- owners share the `authenticated` role, so column grants cannot tell them apart.
-- Calls without a JWT user (service_role, migrations, superuser) are trusted and skip the guard.
create function public.tenants_guard_protected_columns() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.id is distinct from old.id
      or new.slug is distinct from old.slug
      or new.status is distinct from old.status
      or new.cohort is distinct from old.cohort)
     and auth.uid() is not null
     and not public.is_agency_admin() then
    raise exception 'only agency admins can change id, slug, status or cohort'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tenants_guard_protected_columns
  before update on public.tenants
  for each row execute function public.tenants_guard_protected_columns();
