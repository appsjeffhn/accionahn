-- Catalog hardening: jsonb/timezone shape checks, column-level UPDATE for service_role
-- and one atomic, tenant-safe save_product function.

-- Shape checks (the app validates the same rules with zod; these stop direct writes).
create function public.catalog_valid_deposit(d jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    case
      when jsonb_typeof(d) <> 'object' or jsonb_typeof(d -> 'value') <> 'number' then false
      when d ->> 'kind' in ('none', 'full') then (d ->> 'value')::numeric = 0
      when d ->> 'kind' = 'percent' then (d ->> 'value')::numeric between 1 and 100
      when d ->> 'kind' = 'fixed' then (d ->> 'value')::numeric >= 0
        and (d ->> 'value')::numeric = trunc((d ->> 'value')::numeric)
      else false
    end, false)
$$;

create function public.catalog_valid_fixed_prices(p jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select jsonb_typeof(p) = 'object' and not exists (
    select 1 from jsonb_each(p) as e(k, v)
    where jsonb_typeof(e.v) <> 'number'
       or (e.v #>> '{}')::numeric < 0
       or (e.v #>> '{}')::numeric <> trunc((e.v #>> '{}')::numeric)
  )
$$;

create function public.catalog_valid_timezone(tz text) returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names n where n.name = tz)
$$;

revoke all on function public.catalog_valid_deposit(jsonb), public.catalog_valid_fixed_prices(jsonb),
  public.catalog_valid_timezone(text) from public, anon;
grant execute on function public.catalog_valid_deposit(jsonb), public.catalog_valid_fixed_prices(jsonb),
  public.catalog_valid_timezone(text) to authenticated, service_role;

alter table public.products
  add constraint products_deposit_shape check (public.catalog_valid_deposit(deposit)),
  add constraint products_fixed_prices_shape check (public.catalog_valid_fixed_prices(fixed_prices));
alter table public.store_settings
  add constraint store_settings_timezone_valid check (public.catalog_valid_timezone(timezone));

-- service_role may no longer rewrite tenant, parent or id columns on UPDATE.
revoke update on public.products, public.product_variants from service_role;
grant update (kind, reservable, name, description, price_minor, fixed_prices,
  configurable, deposit, images, active) on public.products to service_role;
grant update (label, sku, stock, active) on public.product_variants to service_role;

-- One transaction: product, then variants, with explicit tenant checks.
-- p_variants null leaves variants alone; otherwise variants missing from it are
-- deactivated (never deleted). Raises 42501 for a foreign product or variant id.
create function public.save_product(p_tenant uuid, p_product jsonb, p_variants jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid := (p_product ->> 'id')::uuid;
  v_owner uuid;
  v jsonb;
  v_vid uuid;
  v_vtenant uuid;
  v_vproduct uuid;
  v_keep uuid[] := '{}';
begin
  select p.tenant_id into v_owner from public.products p where p.id = v_id for update;

  if found then
    if v_owner <> p_tenant then
      raise exception 'product belongs to another tenant' using errcode = '42501';
    end if;
    update public.products set
      kind = p_product ->> 'kind',
      reservable = (p_product ->> 'reservable')::boolean,
      name = p_product -> 'name',
      description = p_product -> 'description',
      price_minor = (p_product ->> 'price_minor')::integer,
      fixed_prices = p_product -> 'fixed_prices',
      configurable = nullif(p_product -> 'configurable', 'null'::jsonb),
      deposit = p_product -> 'deposit',
      images = array(select jsonb_array_elements_text(p_product -> 'images')),
      active = (p_product ->> 'active')::boolean
    where id = v_id and tenant_id = p_tenant;
  else
    insert into public.products (id, tenant_id, kind, reservable, name, description, price_minor,
      fixed_prices, configurable, deposit, images, active)
    values (v_id, p_tenant, p_product ->> 'kind', (p_product ->> 'reservable')::boolean,
      p_product -> 'name', p_product -> 'description', (p_product ->> 'price_minor')::integer,
      p_product -> 'fixed_prices', nullif(p_product -> 'configurable', 'null'::jsonb),
      p_product -> 'deposit', array(select jsonb_array_elements_text(p_product -> 'images')),
      (p_product ->> 'active')::boolean);
  end if;

  if p_variants is not null and jsonb_typeof(p_variants) = 'array' then
    for v in select * from jsonb_array_elements(p_variants) loop
      v_vid := (v ->> 'id')::uuid;
      select pv.tenant_id, pv.product_id into v_vtenant, v_vproduct
        from public.product_variants pv where pv.id = v_vid for update;
      if found then
        if v_vtenant <> p_tenant or v_vproduct <> v_id then
          raise exception 'variant belongs to another product or tenant' using errcode = '42501';
        end if;
        update public.product_variants set
          label = v -> 'label',
          sku = v ->> 'sku',
          stock = (v ->> 'stock')::integer,
          active = (v ->> 'active')::boolean
        where id = v_vid;
      else
        insert into public.product_variants (id, tenant_id, product_id, label, sku, stock, active)
        values (v_vid, p_tenant, v_id, v -> 'label', v ->> 'sku', (v ->> 'stock')::integer,
          (v ->> 'active')::boolean);
      end if;
      v_keep := v_keep || v_vid;
    end loop;
    update public.product_variants set active = false
      where product_id = v_id and tenant_id = p_tenant and id <> all (v_keep);
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_product(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_product(uuid, jsonb, jsonb) to service_role;
