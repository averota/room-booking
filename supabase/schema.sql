-- =====================================================================
-- Room Booking App — Supabase schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query)
-- =====================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;
-- Needed for the exclusion constraint below (lets a gist index use "=" on uuid)
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. PROFILES  (one row per auth.users, holds the role)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  role        text not null default 'user' check (role in ('admin', 'user')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever an admin adds a new user in
-- Supabase Auth (Authentication > Users > Add user).
-- New users default to role='user'; promote to 'admin' with:
--   update public.profiles set role = 'admin' where id = '<user-uuid>';
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper used inside RLS policies to check the caller's role
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------
-- 2. ROOMS
-- ---------------------------------------------------------------------
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text not null default '',
  capacity    integer not null default 1 check (capacity > 0),
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. HOLIDAYS
-- ---------------------------------------------------------------------
create table if not exists public.holidays (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  description text not null,
  remark      text not null default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_holidays_date on public.holidays (date);

-- ---------------------------------------------------------------------
-- 4. BOOKINGS
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  topic                text not null,
  invitees             text,               -- optional, free-text, comma-separated, informational only
  start_time           timestamptz not null,
  end_time             timestamptz not null,
  recurrence_group_id  uuid,               -- null for one-off bookings
  recurrence_rule      text,               -- 'daily' | 'weekly' | 'monthly' | 'yearly' | null
  created_at           timestamptz not null default now(),
  constraint end_after_start check (end_time > start_time)
);

create index if not exists idx_bookings_room_time on public.bookings (room_id, start_time, end_time);
create index if not exists idx_bookings_user on public.bookings (user_id);
create index if not exists idx_bookings_group on public.bookings (recurrence_group_id);

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.holidays enable row level security;
alter table public.bookings enable row level security;

-- Table-level grants: RLS policies only decide WHICH ROWS a role can
-- touch — the role still needs baseline permission on the table itself,
-- or every request is rejected before RLS is ever evaluated (Postgres
-- error 42501, "permission denied for table ..."). Supabase normally
-- sets these up automatically, but they're spelled out explicitly here
-- so a from-scratch run of this script can't silently skip them.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.rooms to authenticated;
grant select, insert, update, delete on public.holidays to authenticated;
grant select, insert, update, delete on public.bookings to authenticated;

-- Profiles: everyone signed in can read profiles (needed to show "booked by"),
-- but can only update their own non-role fields; only admins manage roles.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (auth.uid() is not null);

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
  for update using (public.is_admin());

-- Rooms: any signed-in user can view; only admins can add/edit/delete.
drop policy if exists "rooms_select_all" on public.rooms;
create policy "rooms_select_all" on public.rooms
  for select using (auth.uid() is not null);

drop policy if exists "rooms_write_admin_only" on public.rooms;
create policy "rooms_write_admin_only" on public.rooms
  for all using (public.is_admin()) with check (public.is_admin());

-- Holidays: everyone signed in can view (informational); only admins manage them.
drop policy if exists "holidays_select_all" on public.holidays;
create policy "holidays_select_all" on public.holidays
  for select using (auth.uid() is not null);

drop policy if exists "holidays_write_admin_only" on public.holidays;
create policy "holidays_write_admin_only" on public.holidays
  for all using (public.is_admin()) with check (public.is_admin());

-- Bookings: any signed-in user can view all bookings (so the calendar shows
-- everyone's schedule). Users may create bookings for themselves, cancel
-- their own bookings; admins may create/edit/delete any booking.
drop policy if exists "bookings_select_all" on public.bookings;
create policy "bookings_select_all" on public.bookings
  for select using (auth.uid() is not null);

drop policy if exists "bookings_insert_own_or_admin" on public.bookings;
create policy "bookings_insert_own_or_admin" on public.bookings
  for insert with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "bookings_update_own_or_admin" on public.bookings;
create policy "bookings_update_own_or_admin" on public.bookings
  for update using (user_id = auth.uid() or public.is_admin());

drop policy if exists "bookings_delete_own_or_admin" on public.bookings;
create policy "bookings_delete_own_or_admin" on public.bookings
  for delete using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 6. HOLIDAYS BULK-UPLOAD RPCs (atomic append / overwrite / clear)
-- ---------------------------------------------------------------------
-- Direct insert/update/delete on public.holidays already works today —
-- the grants and the holidays_write_admin_only RLS policy above already
-- restrict writes to admins. These RPCs exist purely for ATOMICITY:
-- a PL/pgSQL function body runs as one transaction, so the bulk
-- "Append" and "Overwrite" actions in holidays.js can't fail halfway
-- through and leave the table half-deleted or half-inserted the way a
-- sequence of separate client-side .delete()/.insert() calls can.
--
-- p_rows is a jsonb array of {date, description, remark} objects —
-- pass currentDataset.validRows straight through from holidays.js,
-- e.g. supabase.rpc('admin_append_holidays', { p_rows: validRows }).

create or replace function public.admin_append_holidays(p_rows jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_inserted integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can bulk-append holidays';
  end if;

  with incoming as (
    select
      (r ->> 'date')::date         as date,
      r ->> 'description'          as description,
      coalesce(r ->> 'remark', '') as remark
    from jsonb_array_elements(p_rows) as r
  ),
  inserted as (
    insert into public.holidays (date, description, remark)
    select i.date, i.description, i.remark
    from incoming i
    where not exists (
      select 1 from public.holidays h where h.date = i.date
    )
    on conflict (date) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.admin_append_holidays(jsonb) from public;
grant execute on function public.admin_append_holidays(jsonb) to authenticated;


create or replace function public.admin_overwrite_holidays(p_rows jsonb)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_inserted integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can overwrite the holidays table';
  end if;

  delete from public.holidays where true;  -- delete all existing holidays

  with incoming as (
    select
      (r ->> 'date')::date         as date,
      r ->> 'description'          as description,
      coalesce(r ->> 'remark', '') as remark
    from jsonb_array_elements(p_rows) as r
  ),
  inserted as (
    insert into public.holidays (date, description, remark)
    select date, description, remark
    from incoming
    -- defensive only: the client already de-dupes by date before
    -- calling this, but a stray duplicate in p_rows shouldn't blow up
    -- the whole transaction on the unique(date) constraint.
    on conflict (date) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.admin_overwrite_holidays(jsonb) from public;
grant execute on function public.admin_overwrite_holidays(jsonb) to authenticated;


create or replace function public.admin_clear_holidays()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_deleted integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can clear the holidays table';
  end if;

  with deleted as (
    delete from public.holidays returning 1
  )
  select count(*) into v_deleted from deleted;

  return v_deleted;
end;
$$;

revoke all on function public.admin_clear_holidays() from public;
grant execute on function public.admin_clear_holidays() to authenticated;

-- ---------------------------------------------------------------------
-- 7. OVERLAP PREVENTION (belt-and-braces, deliberately LAST)
-- ---------------------------------------------------------------------
-- The app checks for conflicts in JavaScript before inserting, but that
-- check-then-insert has a small race window if two people submit at the
-- exact same moment. This constraint makes the database itself refuse
-- any overlapping time range for the same room, so a double-booking is
-- never physically possible even if the client-side check is bypassed
-- or racy.
--
-- This runs LAST and on its own transaction boundary intentionally: if
-- your bookings table already has overlapping test data, THIS statement
-- (and only this one) will fail — it can no longer take the RLS
-- policies above down with it. If it fails, clean up the overlapping
-- rows in Table Editor and re-run just this block by itself.
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    room_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  );

-- ---------------------------------------------------------------------
-- 8. SEED (optional) — a couple of sample rooms
-- ---------------------------------------------------------------------
insert into public.rooms (name, location, capacity, description)
values
  ('Harbor', 'Level 2, East Wing', 8, 'Meeting room with harbor view, screen + whiteboard.'),
  ('Summit', 'Level 5, West Wing', 12, 'Large conference room with video conferencing.'),
  ('Atrium', 'Ground Floor', 4, 'Small huddle room near reception.')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- After running this file:
--   1. Go to Authentication > Users and manually add each user (email + password).
--   2. A matching row is auto-created in public.profiles with role = 'user'.
--   3. To make someone an admin, run:
--        update public.profiles set role = 'admin' where id =
--          (select id from auth.users where email = 'admin@example.com');
--
-- Note: section 5 (overlap prevention) is deliberately last and runs
-- separately from RLS setup. If you're re-running this on a database
-- with pre-existing overlapping test bookings, ONLY that final
-- statement will fail — your policies above will already be applied
-- successfully by that point. Clean up the overlaps in Table Editor
-- and re-run just the section 5 block on its own.
-- ---------------------------------------------------------------------
