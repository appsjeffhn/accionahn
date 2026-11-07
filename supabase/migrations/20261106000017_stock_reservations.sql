-- Stock holds. variants.stock null means "not tracked". Holds, releases, commits and
-- owner adjustments are SQL functions run by the store with the service role; concurrency
-- is guaranteed by single-statement conditional updates (stock >= qty / stock + delta >= 0),
-- so two buyers can never take the last unit.
-- Errors: insufficient_stock and stock_not_tracked are P0001 (message tells them apart),
-- 42501 for a variant that does not belong to the tenant, 22023 for a bad quantity.

-- Target of the same-tenant composite FK below.
alter table public.product_variants
  add constraint product_variants_id_tenant_key unique (id, tenant_id);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  variant_id uuid not null,
  -- the orders table arrives in a later migration, so no FK yet
  order_id uuid,
  qty integer not null check (qty > 0),
  status text not null default 'held' check (status in ('held','committed','released')),
  created_at timestamptz not null default now(),
  constraint stock_reservations_variant_fk foreign key (variant_id, tenant_id)
    references public.product_variants (id, tenant_id) on delete cascade
);
create index stock_reservations_tenant_id_idx on public.stock_reservations(tenant_id);
create index stock_reservations_variant_id_idx on public.stock_reservations(variant_id, tenant_id);
create index stock_reservations_order_id_idx on public.stock_reservations(order_id) where order_id is not null;

alter table public.stock_reservations enable row level security;
revoke all on public.stock_reservations from anon, authenticated, service_role;

create policy stock_reservations_select on public.stock_reservations for select to authenticated
  using (tenant_id = public.auth_tenant_id() or public.is_agency_admin());

-- Owners only read. The functions below (service_role) are the only writers, and they
-- may change nothing but the status of a reservation.
grant select on public.stock_reservations to authenticated;
grant select, insert on public.stock_reservations to service_role;
grant update (status) on public.stock_reservations to service_role;

create function public.hold_stock(p_tenant uuid, p_variant uuid, p_qty integer, p_order uuid)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_ok boolean;
  v_owner uuid;
  v_stock integer;
  v_id uuid;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be positive' using errcode = '22023';
  end if;

  update public.product_variants set stock = stock - p_qty
    where id = p_variant and tenant_id = p_tenant and stock >= p_qty
    returning true into v_ok;

  if not found then
    select pv.tenant_id, pv.stock into v_owner, v_stock
      from public.product_variants pv where pv.id = p_variant;
    if not found or v_owner <> p_tenant then
      raise exception 'variant belongs to another tenant' using errcode = '42501';
    end if;
    -- untracked stock (null): nothing to take, the hold is still recorded
    if v_stock is not null then
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;
  end if;

  insert into public.stock_reservations (tenant_id, variant_id, order_id, qty, status)
    values (p_tenant, p_variant, p_order, p_qty, 'held')
    returning id into v_id;
  return v_id;
end;
$$;

-- Returns how many reservations were released. Only 'held' ones give stock back, so a
-- second call, or a call after commit_stock, changes nothing.
create function public.release_stock(p_order uuid) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  with rel as (
    update public.stock_reservations set status = 'released'
      where order_id = p_order and status = 'held'
      returning tenant_id, variant_id, qty
  ), back as (
    update public.product_variants pv set stock = pv.stock + s.q
      from (select tenant_id, variant_id, sum(qty) as q from rel group by tenant_id, variant_id) s
      where pv.id = s.variant_id and pv.tenant_id = s.tenant_id and pv.stock is not null
      returning 1
  )
  select count(*) into v_count from rel;
  return v_count;
end;
$$;

create function public.commit_stock(p_order uuid) returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.stock_reservations set status = 'committed'
    where order_id = p_order and status = 'held';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Owner adjustment by delta (never an absolute overwrite, so stock held by orders is
-- not clobbered). Returns the new stock.
create function public.adjust_stock(p_tenant uuid, p_variant uuid, p_delta integer)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_owner uuid;
  v_stock integer;
  v_new integer;
begin
  update public.product_variants set stock = stock + p_delta
    where id = p_variant and tenant_id = p_tenant and stock is not null and stock + p_delta >= 0
    returning stock into v_new;
  if found then
    return v_new;
  end if;

  select pv.tenant_id, pv.stock into v_owner, v_stock
    from public.product_variants pv where pv.id = p_variant;
  if not found or v_owner <> p_tenant then
    raise exception 'variant belongs to another tenant' using errcode = '42501';
  end if;
  if v_stock is null then
    raise exception 'stock_not_tracked' using errcode = 'P0001';
  end if;
  raise exception 'insufficient_stock' using errcode = 'P0001';
end;
$$;

revoke all on function public.hold_stock(uuid, uuid, integer, uuid),
  public.release_stock(uuid), public.commit_stock(uuid),
  public.adjust_stock(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.hold_stock(uuid, uuid, integer, uuid),
  public.release_stock(uuid), public.commit_stock(uuid),
  public.adjust_stock(uuid, uuid, integer) to service_role;

-- save_product: stock is written only when a variant is INSERTED. For existing variants
-- the supplied stock is ignored, because stock moves through hold/release/adjust and a
-- form save must not overwrite units held by orders.
create or replace function public.save_product(p_tenant uuid, p_product jsonb, p_variants jsonb)
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
