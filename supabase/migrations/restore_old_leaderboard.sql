-- 1. Таблица текущей игры: leaderboard -> corebox_leaderboard
alter table public.leaderboard rename to corebox_leaderboard;
alter table public.corebox_leaderboard rename constraint leaderboard_user_id_key to corebox_leaderboard_user_id_key;
alter table public.corebox_leaderboard rename constraint leaderboard_pkey to corebox_leaderboard_pkey;

-- 2. Восстанавливаем таблицу другой игры с прежней схемой
create table public.leaderboard (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  class_name text not null,
  level integer not null default 1,
  gold integer not null default 0,
  kills integer not null default 0,
  score integer not null default 0,
  created_at timestamptz not null default now()
);
