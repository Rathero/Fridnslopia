-- Persist the re-simulated death count per run so the leaderboard can show it.
-- (Kept out of 001 to preserve the exact spec §5 schema.)

alter table runs add column if not exists deaths int not null default 0;
