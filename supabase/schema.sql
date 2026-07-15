create extension if not exists pgcrypto;

create or replace function public.set_current_timestamp_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.pilots (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null unique,
  name text not null,
  country text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  scenery_name text,
  is_official boolean not null,
  track_id integer,
  online_id text,
  laps integer not null check (laps in (1, 3)),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracks_mode_reference_check check (
    (is_official = true and track_id is not null and online_id is null)
    or
    (is_official = false and track_id is null and online_id is not null)
  )
);

alter table if exists public.tracks
  add column if not exists scenery_name text;

create table if not exists public.leaderboard_monitor_state (
  id uuid primary key default gen_random_uuid(),
  track_uuid uuid not null references public.tracks(id) on delete cascade,
  track_name text not null,
  track_reference text not null,
  laps integer not null check (laps in (1, 3)),
  pilot_user_id bigint,
  pilot_name text not null,
  pilot_key text not null,
  best_lap_time text,
  best_lap_time_ms bigint not null check (best_lap_time_ms > 0),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leaderboard_monitor_state_unique_entry unique (track_uuid, pilot_key)
);

create table if not exists public.pilot_week_points (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  week_key text not null,
  pilot_uuid uuid references public.pilots(id) on delete set null,
  pilot_user_id bigint,
  pilot_name text not null,
  pilot_key text not null,
  total_points integer not null check (total_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_week_points_unique_entry unique (season_year, week_key, pilot_key)
);

create table if not exists public.pilot_season_points (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  pilot_uuid uuid references public.pilots(id) on delete set null,
  pilot_user_id bigint,
  pilot_name text not null,
  pilot_key text not null,
  total_points integer not null check (total_points >= 0),
  weeks_played integer not null default 0 check (weeks_played >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_season_points_unique_entry unique (season_year, pilot_key)
);

-- Tabla legacy: se mantiene por compatibilidad histórica, pero ya no se usa.
create table if not exists public.weekly_points (
  id uuid primary key default gen_random_uuid(),
  season_year integer not null,
  week_key text not null,
  track_uuid uuid not null references public.tracks(id) on delete cascade,
  track_name text not null,
  track_reference text not null,
  laps integer not null check (laps in (1, 3)),
  pilot_uuid uuid references public.pilots(id) on delete set null,
  pilot_user_id bigint,
  pilot_name text not null,
  pilot_key text not null,
  position integer not null check (position > 0),
  points integer not null check (points > 0),
  lap_time text,
  lap_time_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_points_unique_entry unique (season_year, week_key, track_uuid, pilot_key)
);

create unique index if not exists tracks_official_reference_unique on public.tracks (track_id, laps);
create unique index if not exists tracks_unofficial_reference_unique on public.tracks (online_id, laps);
create index if not exists tracks_active_idx on public.tracks (active, laps);
create index if not exists pilots_active_idx on public.pilots (active);
create index if not exists leaderboard_monitor_track_idx on public.leaderboard_monitor_state (track_uuid);
create index if not exists leaderboard_monitor_pilot_idx on public.leaderboard_monitor_state (pilot_key, track_uuid);
create index if not exists pilot_week_points_season_idx on public.pilot_week_points (season_year, week_key);
create index if not exists pilot_week_points_pilot_idx on public.pilot_week_points (pilot_key, season_year);
create index if not exists pilot_season_points_season_idx on public.pilot_season_points (season_year, total_points desc);
create index if not exists pilot_season_points_pilot_idx on public.pilot_season_points (pilot_key, season_year);
create index if not exists weekly_points_season_idx on public.weekly_points (season_year, week_key);
create index if not exists weekly_points_pilot_idx on public.weekly_points (pilot_key, season_year);

create or replace trigger set_pilots_updated_at
before update on public.pilots
for each row
execute function public.set_current_timestamp_updated_at();

create or replace trigger set_tracks_updated_at
before update on public.tracks
for each row
execute function public.set_current_timestamp_updated_at();

create or replace trigger set_leaderboard_monitor_state_updated_at
before update on public.leaderboard_monitor_state
for each row
execute function public.set_current_timestamp_updated_at();

create or replace trigger set_pilot_week_points_updated_at
before update on public.pilot_week_points
for each row
execute function public.set_current_timestamp_updated_at();

create or replace trigger set_pilot_season_points_updated_at
before update on public.pilot_season_points
for each row
execute function public.set_current_timestamp_updated_at();

create or replace trigger set_weekly_points_updated_at
before update on public.weekly_points
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.pilots enable row level security;
alter table public.tracks enable row level security;
alter table public.leaderboard_monitor_state enable row level security;
alter table public.pilot_week_points enable row level security;
alter table public.pilot_season_points enable row level security;
alter table public.weekly_points enable row level security;

drop policy if exists "public read pilots" on public.pilots;
create policy "public read pilots" on public.pilots
for select
to anon, authenticated
using (true);

drop policy if exists "public read tracks" on public.tracks;
create policy "public read tracks" on public.tracks
for select
to anon, authenticated
using (true);

drop policy if exists "public read pilot week points" on public.pilot_week_points;
create policy "public read pilot week points" on public.pilot_week_points
for select
to anon, authenticated
using (true);

drop policy if exists "public read pilot season points" on public.pilot_season_points;
create policy "public read pilot season points" on public.pilot_season_points
for select
to anon, authenticated
using (true);

drop policy if exists "public read weekly points" on public.weekly_points;
create policy "public read weekly points" on public.weekly_points
for select
to anon, authenticated
using (true);
