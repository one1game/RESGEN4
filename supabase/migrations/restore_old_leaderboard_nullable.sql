-- Восстанавливаем nullable как в оригинале другой игры
alter table public.leaderboard
  alter column level drop not null,
  alter column gold drop not null,
  alter column kills drop not null,
  alter column score drop not null,
  alter column created_at drop not null;
