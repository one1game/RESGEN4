-- Пересоздаём leaderboard под схему, которую ожидает клиент (save.js / game.js)
drop table if exists public.leaderboard;

create table public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  username text not null default 'Игрок',
  total_mined bigint not null default 0,
  neuro_score bigint not null default 0,
  nights integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

create policy "leaderboard_read_all" on public.leaderboard
  for select using (true);

create policy "leaderboard_insert_own" on public.leaderboard
  for insert with check (auth.uid() = user_id);

create policy "leaderboard_update_own" on public.leaderboard
  for update using (auth.uid() = user_id);
