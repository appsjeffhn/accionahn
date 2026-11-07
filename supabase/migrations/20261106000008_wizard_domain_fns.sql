-- Domain mutations used by the onboarding wizard. Each locks the tenant row and
-- proceeds only while the tenant is still 'pending', so it serializes with the
-- final pending -> active UPDATE (which waits on the same row lock).
create function public.wizard_set_subdomain(p_tenant_id uuid, p_hostname text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from public.tenants where id = p_tenant_id and status = 'pending' for update;
  if not found then
    raise exception 'tenant is not pending' using errcode = 'WZ001';
  end if;
  delete from public.tenant_domains where tenant_id = p_tenant_id and kind = 'subdomain';
  insert into public.tenant_domains (hostname, tenant_id, kind)
    values (p_hostname, p_tenant_id, 'subdomain');
end;
$$;

create function public.wizard_remove_subdomain(p_tenant_id uuid, p_hostname text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  perform 1 from public.tenants where id = p_tenant_id and status = 'pending' for update;
  if not found then
    return;
  end if;
  delete from public.tenant_domains where tenant_id = p_tenant_id and hostname = p_hostname;
end;
$$;

revoke all on function public.wizard_set_subdomain(uuid, text) from public, anon, authenticated;
revoke all on function public.wizard_remove_subdomain(uuid, text) from public, anon, authenticated;
grant execute on function public.wizard_set_subdomain(uuid, text) to service_role;
grant execute on function public.wizard_remove_subdomain(uuid, text) to service_role;
