insert into public.pilots (user_id, name, country, active)
values
  (1001, 'Pilot One', 'ES', true),
  (1002, 'Pilot Two', 'PT', true),
  (1003, 'Pilot Three', 'FR', true)
on conflict (user_id) do update set
  name = excluded.name,
  country = excluded.country,
  active = excluded.active;

insert into public.tracks (name, is_official, track_id, online_id, laps, active)
values
  ('Track semanal 1', true, 1234, null, 1, true),
  ('Track semanal 2', false, null, 'custom-track-demo', 3, true)
on conflict do nothing;
