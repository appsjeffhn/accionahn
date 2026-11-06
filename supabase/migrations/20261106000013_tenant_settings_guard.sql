-- tenants.settings mixes owner-editable keys (alert phone, extra currencies, order
-- fields) with agency-only keys (aiCapCents, whatsappMode, retentionMonths). Owners
-- may update their own row, so the guard now also compares each agency-only key.
-- Any other settings key stays owner-editable. Calls without a JWT user
-- (service_role, migrations, superuser) are trusted and skip the guard, as before.
create or replace function public.tenants_guard_protected_columns() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_agency_admin() then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.slug is distinct from old.slug
     or new.status is distinct from old.status
     or new.cohort is distinct from old.cohort then
    raise exception 'only agency admins can change id, slug, status or cohort'
      using errcode = '42501';
  end if;
  if new.settings -> 'aiCapCents' is distinct from old.settings -> 'aiCapCents'
     or new.settings -> 'whatsappMode' is distinct from old.settings -> 'whatsappMode'
     or new.settings -> 'retentionMonths' is distinct from old.settings -> 'retentionMonths' then
    raise exception 'only agency admins can change aiCapCents, whatsappMode or retentionMonths'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Currency codes are three uppercase letters. The wizard allowlist (SUPPORTED_CURRENCIES)
-- stays the app-level rule; this only stops malformed values written through other paths.
create function public.is_currency_code_array(codes text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(bool_and(coalesce(c ~ '^[A-Z]{3}$', false)), true) from unnest(codes) as c
$$;

alter table public.tenants
  add constraint tenants_base_currency_format check (base_currency ~ '^[A-Z]{3}$') not valid;
alter table public.tenants
  add constraint tenants_enabled_currencies_format check (public.is_currency_code_array(enabled_currencies)) not valid;
alter table public.tenants validate constraint tenants_base_currency_format;
alter table public.tenants validate constraint tenants_enabled_currencies_format;
