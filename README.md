# Roombook — Meeting Room Booking

A lightweight meeting-room booking app: Bootstrap 5 front end, Supabase
for auth + database. No build step — plain HTML/CSS/JS, deployable to
GitHub Pages.

## Features

- **Login-only access.** Users are created manually in Supabase; there's
  no public sign-up.
- **Two roles:**
  - **Admin** — add/edit/delete rooms, and edit/cancel *any* booking.
  - **User** — view all rooms' schedules, create bookings, edit/cancel
    their own bookings.
- **Room picker + monthly calendar.** Pick a room, see the whole month;
  days with bookings show a time/topic chip.
- **Recurring bookings** — daily, weekly, monthly, or yearly, up to a
  chosen end date.
- **Conflict prevention** — a new booking (or any occurrence of a
  recurring one) is rejected with a clear message if it overlaps an
  existing booking in that room.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and
   run it. This creates the `profiles`, `rooms`, and `bookings` tables,
   the trigger that auto-creates a profile for each new user, and all
   Row Level Security policies.
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key
4. Open `js/supabaseClient.js` and paste them in:
   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...';
   ```

## 2. Create users

There's no sign-up page by design — an admin creates every account:

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter their email and a temporary password (share it with them
   separately). A matching row is auto-created in `profiles` with
   `role = 'user'`.
3. To make someone an admin, run in the SQL Editor:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'admin@example.com');
   ```

Users can sign in right away at `index.html` with the email/password
you set. (There's no password-reset flow here — reset a password from
**Authentication → Users** in Supabase if someone's locked out.)

## 3. Add rooms

Sign in as an admin, open **Manage rooms**, and add your meeting rooms
(name, location, capacity, description). Two sample rooms are seeded
by the SQL script — edit or delete them as needed.

## 4. Deploy to GitHub Pages

1. Push this folder to a public GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose the branch (e.g. `main`) and root folder,
   then save.
4. GitHub gives you a URL like `https://yourname.github.io/repo-name/`.
   `index.html` (the login page) will load first.

That's it — no build step, no server to run.

## File structure

```
index.html                   Login page (site entry point)
pages/
  dashboard.html              Room picker + monthly calendar + booking modal
  rooms.html                  Admin-only room management
assets/
  css/styles.css               All styling (design tokens at the top)
  js/supabaseClient.js         Supabase project URL/key — edit this first
  js/auth.js                   Session guard, role visibility, logout
  js/utils.js                  Date/time helpers, recurrence expansion, toasts
  js/calendar.js                Dashboard logic (rooms, calendar, bookings)
  js/admin.js                   Room management logic
  img/                          (empty — for a logo/favicon if you add one)
supabase/
  schema.sql                    Tables, RLS policies, trigger, seed rooms
README.md
.gitignore
```

This follows the common static-site convention of keeping the entry
point (`index.html`) at the repo root — required by GitHub Pages —
with everything else grouped by type under `assets/` and secondary
pages under `pages/`. All links and script/stylesheet paths already
account for this (pages inside `pages/` reference assets as
`../assets/...` and the login page as `../index.html`).

## How recurrence & conflict checking works

- Creating a recurring booking expands it into individual occurrences
  client-side (e.g. "weekly until March 1" → one row per week).
- Before saving, every occurrence is checked against existing bookings
  for that room. If **any** occurrence overlaps an existing booking,
  the whole request is rejected and you'll see exactly which dates
  clash — nothing is partially booked.
- All occurrences of a recurring booking share a `recurrence_group_id`,
  so cancelling offers a choice: just that one date, or the whole
  series. Editing only ever changes the single occurrence you opened.

## Notes on security

Row Level Security (RLS) is enforced in Postgres itself (see
`supabase/schema.sql`), not just hidden in the front end:

- Any signed-in user can **read** all rooms and bookings (needed to
  show the shared calendar).
- Only admins can insert/update/delete **rooms**.
- A booking can only be inserted/edited/deleted by its owner or an
  admin.

So even though `SUPABASE_ANON_KEY` is visible in the front-end code,
users can't bypass these rules by editing the JavaScript.
