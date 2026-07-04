-- Streamer rooms + tournament sessions (no player cap).
-- A room runs a SESSION of N circuits; points accumulate across circuits and a
-- final podium is computed. Room circuits reuse daily_courses + runs (so
-- anti-cheat re-sim, leaderboards and ghosts work unchanged) — they are just
-- daily_courses rows tagged with room_id + idx instead of league_id + date.

create table if not exists rooms (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  host_id      uuid not null references users(id),
  num_courses  int not null default 5,
  status       text not null default 'open',   -- 'open' | 'finished'
  created_at   timestamptz not null default now()
);

create table if not exists room_members (
  room_id      uuid not null references rooms(id),
  user_id      uuid not null references users(id),
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table daily_courses add column if not exists room_id uuid references rooms(id);
alter table daily_courses add column if not exists idx int;

-- The "one global course per date" index must not catch room courses.
drop index if exists daily_courses_global_date_idx;
create unique index if not exists daily_courses_global_date_idx
  on daily_courses (play_date)
  where league_id is null and room_id is null;

-- One course per (room, index).
create unique index if not exists daily_courses_room_idx
  on daily_courses (room_id, idx)
  where room_id is not null;
