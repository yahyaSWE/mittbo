create extension if not exists pgcrypto;
create schema if not exists private;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  address text not null,
  created_at timestamptz not null default now()
);
create table public.units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id),
  label text not null,
  created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  unit_id uuid references public.units(id),
  role text not null check (role in ('tenant','admin','worker')),
  name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  check ((role = 'tenant' and unit_id is not null) or (role <> 'tenant' and unit_id is null))
);
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  unit_id uuid not null references public.units(id),
  tenant_id uuid not null references public.profiles(id),
  assignee_id uuid references public.profiles(id),
  title text not null check (char_length(title) between 4 and 100),
  category text not null check (category in ('VVS','El','Vitvaror','Värme','Övrigt')),
  description text not null check (char_length(description) between 8 and 2000),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'received' check (status in ('received','assigned','in_progress','waiting','resolved','closed')),
  visit_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('created','assigned','status','message','visit')),
  body text not null check (char_length(body) between 1 and 2000),
  visibility text not null check (visibility in ('public','internal')),
  created_at timestamptz not null default now()
);
create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size bigint not null check (size between 1 and 5242880),
  created_at timestamptz not null default now()
);
create table public.notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  building_id uuid references public.buildings(id),
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);

create index on public.buildings(organization_id);
create index on public.units(building_id);
create index on public.profiles(organization_id, role);
create index on public.profiles(unit_id);
create index on public.tickets(organization_id, created_at desc);
create index on public.tickets(tenant_id, created_at desc);
create index on public.tickets(assignee_id, created_at desc);
create index on public.ticket_events(ticket_id, created_at);
create index on public.ticket_attachments(ticket_id, created_at);
create index on public.notices(organization_id, published_at desc);

-- These SECURITY DEFINER helpers live outside the exposed API schema to break RLS recursion.
create function private.actor_org() returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = (select auth.uid())
$$;
create function private.actor_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;
create function private.actor_unit() returns uuid language sql stable security definer set search_path = '' as $$
  select unit_id from public.profiles where id = (select auth.uid())
$$;
create function private.actor_building() returns uuid language sql stable security definer set search_path = '' as $$
  select u.building_id from public.profiles p join public.units u on u.id = p.unit_id
  where p.id = (select auth.uid())
$$;
create function private.can_view_ticket(ticket_uuid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tickets t join public.profiles p on p.id = (select auth.uid())
    where t.id = ticket_uuid and t.organization_id = p.organization_id
      and (p.role = 'admin' or p.role = 'tenant' and t.tenant_id = p.id
        or p.role = 'worker' and t.assignee_id = p.id)
  )
$$;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.actor_org(), private.actor_role(), private.actor_unit(), private.actor_building(), private.can_view_ticket(uuid) from public;
grant execute on function private.actor_org(), private.actor_role(), private.actor_unit(), private.actor_building(), private.can_view_ticket(uuid) to authenticated;

create function private.validate_profile_unit() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.unit_id is not null and not exists (
    select 1 from public.units u join public.buildings b on b.id = u.building_id
    where u.id = new.unit_id and b.organization_id = new.organization_id
  ) then raise exception 'Profile unit belongs to another organization'; end if;
  return new;
end $$;
create trigger profiles_unit_guard before insert or update on public.profiles
  for each row execute function private.validate_profile_unit();

create function private.validate_ticket_refs() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.units u join public.buildings b on b.id = u.building_id
    join public.profiles p on p.id = new.tenant_id
    where u.id = new.unit_id and b.organization_id = new.organization_id
      and p.organization_id = new.organization_id and p.unit_id = new.unit_id and p.role = 'tenant'
  ) then raise exception 'Ticket tenant/unit/organization mismatch'; end if;
  if new.assignee_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.assignee_id
      and p.organization_id = new.organization_id and p.role = 'worker'
  ) then raise exception 'Assignee must be a worker in the same organization'; end if;
  return new;
end $$;
create trigger ticket_refs_guard before insert or update on public.tickets
  for each row execute function private.validate_ticket_refs();

create function private.ticket_write_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_role text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (
      private.actor_role() <> 'tenant' or new.tenant_id <> auth.uid()
      or new.unit_id <> private.actor_unit() or new.organization_id <> private.actor_org()
      or new.status <> 'received' or new.priority <> 'normal' or new.assignee_id is not null
    ) then raise exception 'Invalid ticket creation'; end if;
    return new;
  end if;
  new.updated_at := now();
  if auth.uid() is null then return new; end if; -- privileged seed/maintenance
  actor_role := private.actor_role();
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
    or new.unit_id is distinct from old.unit_id or new.tenant_id is distinct from old.tenant_id
    or new.title is distinct from old.title or new.description is distinct from old.description
    or new.category is distinct from old.category or new.created_at is distinct from old.created_at
  then raise exception 'Immutable ticket fields changed'; end if;
  if actor_role = 'tenant' then
    if old.tenant_id <> auth.uid() or old.status <> 'resolved' or new.status <> 'closed'
      or new.priority is distinct from old.priority or new.assignee_id is distinct from old.assignee_id
      or new.visit_at is distinct from old.visit_at
    then raise exception 'Tenant may only close a resolved ticket'; end if;
  elsif actor_role = 'worker' then
    if old.assignee_id <> auth.uid() or old.status = 'closed' or new.assignee_id is distinct from old.assignee_id
      or new.priority is distinct from old.priority or new.status not in ('in_progress','waiting','resolved')
    then raise exception 'Worker change denied'; end if;
  elsif actor_role = 'admin' then
    if new.status = 'assigned' and new.assignee_id is null then raise exception 'Assigned ticket needs worker'; end if;
  else raise exception 'Ticket change denied'; end if;
  return new;
end $$;
create trigger ticket_write_guard before insert or update on public.tickets
  for each row execute function private.ticket_write_guard();

create function private.ticket_event_trigger() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events(ticket_id, actor_id, kind, body, visibility)
    values (new.id, new.tenant_id, 'created', new.description, 'public');
  else
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
      insert into public.ticket_events(ticket_id, actor_id, kind, body, visibility)
      values (new.id, coalesce(auth.uid(), new.assignee_id), 'assigned',
        'Tilldelat ' || (select name from public.profiles where id = new.assignee_id), 'public');
    end if;
    if new.priority is distinct from old.priority then
      insert into public.ticket_events(ticket_id, actor_id, kind, body, visibility)
      values (new.id, coalesce(auth.uid(), new.tenant_id), 'status', 'Prioritet ändrad till ' || new.priority, 'internal');
    end if;
    if new.status is distinct from old.status then
      insert into public.ticket_events(ticket_id, actor_id, kind, body, visibility)
      values (new.id, coalesce(auth.uid(), new.tenant_id), 'status', 'Status ändrad till ' || new.status, 'public');
    end if;
    if new.visit_at is distinct from old.visit_at and new.visit_at is not null then
      insert into public.ticket_events(ticket_id, actor_id, kind, body, visibility)
      values (new.id, coalesce(auth.uid(), new.tenant_id), 'visit', 'Besök planerat ' || new.visit_at::text, 'public');
    end if;
  end if;
  return null;
end $$;
create trigger ticket_events_after_insert after insert on public.tickets
  for each row execute function private.ticket_event_trigger();
create trigger ticket_events_after_update after update on public.tickets
  for each row execute function private.ticket_event_trigger();

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.buildings enable row level security;
alter table public.units enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.notices enable row level security;

grant usage on schema public to authenticated;
revoke all on public.organizations, public.profiles, public.buildings, public.units,
  public.tickets, public.ticket_events, public.ticket_attachments, public.notices from anon;
grant select on public.organizations, public.profiles, public.buildings, public.units,
  public.tickets, public.ticket_events, public.ticket_attachments, public.notices to authenticated;
grant insert on public.tickets, public.ticket_events, public.ticket_attachments to authenticated;
grant update on public.tickets to authenticated;

create policy organizations_read on public.organizations for select to authenticated
  using (id = (select private.actor_org()));
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or organization_id = (select private.actor_org())
    and (select private.actor_role()) in ('admin','worker'));
create policy buildings_read on public.buildings for select to authenticated
  using (organization_id = (select private.actor_org()) and (
    (select private.actor_role()) in ('admin','worker') or id = (select private.actor_building())));
create policy units_read on public.units for select to authenticated
  using (id = (select private.actor_unit()) or
    (select private.actor_role()) in ('admin','worker') and exists (
      select 1 from public.buildings b where b.id = building_id and b.organization_id = (select private.actor_org())
    ));
create policy tickets_read on public.tickets for select to authenticated
  using ((select private.can_view_ticket(id)));
create policy tickets_insert on public.tickets for insert to authenticated
  with check ((select private.actor_role()) = 'tenant' and tenant_id = (select auth.uid())
    and organization_id = (select private.actor_org()) and unit_id = (select private.actor_unit())
    and assignee_id is null and status = 'received' and priority = 'normal');
create policy tickets_update on public.tickets for update to authenticated
  using ((select private.can_view_ticket(id))) with check ((select private.can_view_ticket(id)));
create policy events_read on public.ticket_events for select to authenticated
  using ((select private.can_view_ticket(ticket_id)) and
    (visibility = 'public' or (select private.actor_role()) in ('admin','worker')));
create policy events_insert on public.ticket_events for insert to authenticated
  with check (actor_id = (select auth.uid()) and kind = 'message'
    and (select private.can_view_ticket(ticket_id))
    and (visibility = 'public' or (select private.actor_role()) in ('admin','worker')));
create policy attachments_read on public.ticket_attachments for select to authenticated
  using ((select private.can_view_ticket(ticket_id)));
create policy attachments_insert on public.ticket_attachments for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and (select private.can_view_ticket(ticket_id))
    and split_part(storage_path, '/', 1) = (select private.actor_org())::text
    and split_part(storage_path, '/', 2) = ticket_id::text);
create policy notices_read on public.notices for select to authenticated
  using (organization_id = (select private.actor_org()) and (
    (select private.actor_role()) in ('admin','worker') or building_id is null or
    exists (select 1 from public.units u where u.id = (select private.actor_unit()) and u.building_id = notices.building_id)
  ));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-attachments', 'ticket-attachments', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy mittbo_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (select private.actor_org())::text
    and exists (select 1 from public.tickets t where t.id::text = (storage.foldername(name))[2]
      and (select private.can_view_ticket(t.id))));
create policy mittbo_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-attachments'
    and (storage.foldername(name))[1] = (select private.actor_org())::text
    and exists (select 1 from public.tickets t where t.id::text = (storage.foldername(name))[2]
      and (select private.can_view_ticket(t.id))));
create policy mittbo_storage_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-attachments' and owner_id = (select auth.uid())::text);
