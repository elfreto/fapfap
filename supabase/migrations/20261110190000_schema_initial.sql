-- Schéma initial FapFap, appliqué le 10/11/2026 sur le projet Supabase « fapfap ».

-- Joueurs : pseudo + jeton secret (hashé), crédits virtuels
create table public.players (
  id uuid primary key default gen_random_uuid(),
  pseudo text not null check (char_length(pseudo) between 1 and 20),
  token_hash text not null unique,
  balance integer not null default 10000 check (balance >= 0),
  table_id text,
  created_at timestamptz not null default now()
);

-- Tables de jeu : état complet (mains secrètes comprises), jamais lisible par les clients
create table public.game_tables (
  id text primary key,
  stake integer not null check (stake in (25,50,100,200,300,400,500,1000,2000,5000,10000)),
  capacity integer not null check (capacity between 2 and 4),
  seats uuid[] not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','playing','closed')),
  round_no integer not null default 0,
  first_player uuid,
  state jsonb not null default '{"round": null, "deadline": null}'::jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Vue publique d'une table (aucune main cachée), diffusée en temps réel
create table public.table_public (
  id text primary key references public.game_tables(id) on delete cascade,
  data jsonb not null,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Journal des mouvements de crédits (piste d'audit, idempotent par manche)
create table public.ledger (
  id bigserial primary key,
  table_id text references public.game_tables(id) on delete set null,
  round_no integer,
  player_id uuid references public.players(id) on delete set null,
  amount integer not null,
  reason text not null check (reason in ('manche','commission','recharge')),
  created_at timestamptz not null default now()
);
create unique index ledger_round_player_uniq on public.ledger (table_id, round_no, player_id, reason) where player_id is not null and table_id is not null;
create unique index ledger_round_commission_uniq on public.ledger (table_id, round_no, reason) where player_id is null and table_id is not null;
create index players_table_idx on public.players (table_id);

alter table public.players enable row level security;
alter table public.game_tables enable row level security;
alter table public.table_public enable row level security;
alter table public.ledger enable row level security;

create policy "table_public lisible par tous" on public.table_public for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.table_public;

-- Enregistre un nouvel état de table de façon atomique, avec contrôle de version
-- et application des mouvements de crédits (une seule fois par manche grâce aux index uniques).
create or replace function public.commit_table(
  p_id text,
  p_version integer,
  p_seats uuid[],
  p_status text,
  p_round_no integer,
  p_first_player uuid,
  p_state jsonb,
  p_public jsonb,
  p_ledger jsonb default '[]'::jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new integer;
  e jsonb;
begin
  update game_tables
     set seats = p_seats, status = p_status, round_no = p_round_no, first_player = p_first_player,
         state = p_state, version = version + 1, updated_at = now()
   where id = p_id and version = p_version
  returning version into v_new;
  if v_new is null then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;

  update players set table_id = null where table_id = p_id and not (id = any(p_seats));
  update players set table_id = p_id where id = any(p_seats);

  for e in select * from jsonb_array_elements(p_ledger) loop
    insert into ledger (table_id, round_no, player_id, amount, reason)
    values (p_id, p_round_no, nullif(e->>'player_id','')::uuid, (e->>'amount')::integer, e->>'reason');
    if nullif(e->>'player_id','') is not null then
      update players set balance = balance + (e->>'amount')::integer where id = (e->>'player_id')::uuid;
    end if;
  end loop;

  insert into table_public (id, data, version, updated_at) values (p_id, p_public, v_new, now())
  on conflict (id) do update set data = excluded.data, version = excluded.version, updated_at = now();
  return v_new;
end;
$$;

revoke all on function public.commit_table(text,integer,uuid[],text,integer,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;

-- Caisses administrateur : soldes des joueurs et contributions du croupier
create view public.caisses with (security_invoker = true) as
select
  (select coalesce(sum(balance),0) from players) as soldes_joueurs,
  (select coalesce(sum(amount),0) from ledger where reason = 'commission') as caisse_croupier;
revoke all on public.caisses from anon, authenticated;
