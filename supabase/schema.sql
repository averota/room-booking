-- =====================================================================
-- Room Booking App — Supabase schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query)
-- =====================================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

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
-- 3. BOOKINGS
-- ---------------------------------------------------------------------
create table if not exists public.bookings (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  topic                text not null,
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
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.bookings enable row level security;

-- Profiles: everyone signed in can read profiles (needed to show "booked by"),
-- but can only update their own non-role fields; only admins manage roles.
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles
  for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
  for update using (public.is_admin());

-- Rooms: any signed-in user can view; only admins can add/edit/delete.
drop policy if exists "rooms_select_all" on public.rooms;
create policy "rooms_select_all" on public.rooms
  for select using (auth.role() = 'authenticated');

drop policy if exists "rooms_write_admin_only" on public.rooms;
create policy "rooms_write_admin_only" on public.rooms
  for all using (public.is_admin()) with check (public.is_admin());

-- Bookings: any signed-in user can view all bookings (so the calendar shows
-- everyone's schedule). Users may create bookings for themselves, cancel
-- their own bookings; admins may create/edit/delete any booking.
drop policy if exists "bookings_select_all" on public.bookings;
create policy "bookings_select_all" on public.bookings
  for select using (auth.role() = 'authenticated');

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
-- 5. SEED (optional) — a couple of sample rooms
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
-- ---------------------------------------------------------------------
