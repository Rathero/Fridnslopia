-- Notifications (spec §3/§5 M5): overtakes, trap hits, streak-in-danger.

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  type          text not null,        -- 'overtaken' | 'trap_hit' | 'streak' ...
  payload       jsonb not null default '{}'::jsonb,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
