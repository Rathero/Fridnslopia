-- TRAMPA core schema (spec §5). Idempotent: safe to run repeatedly.

create extension if not exists "pgcrypto";

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,
  created_at    timestamptz not null default now()
);

create table if not exists leagues (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  invite_code        text unique not null,
  owner_id           uuid not null references users(id),
  streak_count       int not null default 0,
  streak_active_date date,            -- last day the streak was kept alive
  created_at         timestamptz not null default now()
);

create table if not exists league_members (
  league_id     uuid not null references leagues(id),
  user_id       uuid not null references users(id),
  joined_at     timestamptz not null default now(),
  primary key (league_id, user_id)
);

-- 1 course per league per day (league_id null = global course).
create table if not exists daily_courses (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid references leagues(id),   -- null = global
  play_date     date not null,
  daily_seed    bigint not null,
  config        jsonb not null,                -- validated LLM output
  verified      boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (league_id, play_date)
);

create table if not exists runs (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references daily_courses(id),
  user_id       uuid not null references users(id),
  time_ms       int not null,                  -- finish time
  input_log     jsonb not null,                -- input stream (spec §6.1)
  finished      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists runs_course_time_idx on runs (course_id, time_ms);
create index if not exists runs_course_user_idx on runs (course_id, user_id);

create table if not exists traps (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references daily_courses(id),
  user_id       uuid not null references users(id),
  slot_x        int not null,
  slot_y        int not null,
  trap_type     text not null,
  hits          int not null default 0,        -- how many friends fell in
  created_at    timestamptz not null default now(),
  unique (course_id, user_id)                  -- 1 trap per player per course
);
create index if not exists traps_course_idx on traps (course_id);

-- Partial unique index enforcing "one global course per play_date" (league_id
-- is null there, and NULLs are distinct in a normal unique constraint).
create unique index if not exists daily_courses_global_date_idx
  on daily_courses (play_date)
  where league_id is null;
