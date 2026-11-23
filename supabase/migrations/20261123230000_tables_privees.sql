-- Tables publiques ou privées (décision de LeCerf du 23/11/2026) et créateur de la table, pour le Salon.
alter table public.game_tables
  add column is_private boolean not null default false,
  add column password_hash text,
  add column created_by uuid references public.players(id) on delete set null,
  add constraint game_tables_private_password check (not is_private or password_hash is not null);

-- Le Salon liste les tables qui ne sont pas fermées.
create index game_tables_open_idx on public.game_tables (created_at desc) where status <> 'closed';

-- Statistiques de la page Profil, calculées sur le journal des manches.
create or replace function public.player_stats(p_player uuid)
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'rounds', count(*),
    'wins', count(*) filter (where amount > 0),
    'gained', coalesce(sum(amount) filter (where amount > 0), 0),
    'lost', coalesce(-sum(amount) filter (where amount < 0), 0)
  )
  from ledger
  where player_id = p_player and reason = 'manche';
$$;
revoke all on function public.player_stats(uuid) from public, anon, authenticated;
