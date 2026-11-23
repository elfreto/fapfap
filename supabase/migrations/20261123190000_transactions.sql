-- 23/11/2026 : page Transactions (dépôts et retraits), sur le modèle fourni par LeCerf. Pas d'IBAN.
-- Chaque opération est une demande vérifiée par un administrateur (voir validate_transaction / refuse_transaction).

alter table public.ledger drop constraint if exists ledger_reason_check;
alter table public.ledger add constraint ledger_reason_check
  check (reason in ('manche','commission','recharge','depot','retrait','retrait_rendu'));

create table public.transactions (
  id bigserial primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  kind text not null check (kind in ('depot','retrait')),
  method text not null check (method in ('paypal','mobile_money','orange_money')),
  amount integer not null check (amount > 0),
  -- Dépôt : référence du transfert saisie par le joueur. Retrait : numéro ou adresse PayPal de réception.
  reference text,
  account text,
  status text not null default 'en_attente' check (status in ('en_attente','validee','refusee','annulee')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index transactions_player_idx on public.transactions (player_id, created_at desc);
create index transactions_pending_idx on public.transactions (created_at) where status = 'en_attente';
alter table public.transactions enable row level security;

-- Coordonnées où les joueurs envoient leurs dépôts. À remplir par l'administrateur (éditeur de tables Supabase).
-- ussd : code à composer, avec {montant} remplacé par le montant (ex. *126*1*1*6XXXXXXXX*{montant}#).
create table public.payment_accounts (
  method text primary key check (method in ('paypal','mobile_money','orange_money')),
  account text not null default '',
  ussd text not null default '',
  note text not null default ''
);
alter table public.payment_accounts enable row level security;
insert into public.payment_accounts (method) values ('paypal'), ('mobile_money'), ('orange_money') on conflict do nothing;

-- Nouvelle demande. Un retrait réserve aussitôt le montant (retiré du solde, jamais en dessous de zéro).
create or replace function public.request_transaction(
  p_player uuid, p_kind text, p_method text, p_amount integer, p_reference text, p_account text, p_max_pending integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_balance integer;
  v_tx transactions;
begin
  perform 1 from players where id = p_player for update;
  if (select count(*) from transactions where player_id = p_player and status = 'en_attente') >= p_max_pending then
    raise exception 'trop_de_demandes' using errcode = 'P0001';
  end if;
  if p_kind = 'retrait' then
    update players set balance = balance - p_amount
     where id = p_player and balance >= p_amount and table_id is null
    returning balance into v_balance;
    if v_balance is null then
      raise exception 'solde_insuffisant' using errcode = 'P0001';
    end if;
    insert into ledger (player_id, amount, reason) values (p_player, -p_amount, 'retrait');
  else
    select balance into v_balance from players where id = p_player;
  end if;
  insert into transactions (player_id, kind, method, amount, reference, account)
  values (p_player, p_kind, p_method, p_amount, p_reference, p_account)
  returning * into v_tx;
  return jsonb_build_object('balance', v_balance, 'transaction', to_jsonb(v_tx));
end;
$$;

-- Clôture d'une demande en attente. Rend les crédits d'un retrait refusé ou annulé ; crédite un dépôt validé.
create or replace function public.close_transaction(p_id bigint, p_status text, p_player uuid default null) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx transactions;
  v_balance integer;
begin
  if p_status not in ('validee','refusee','annulee') then
    raise exception 'statut_invalide' using errcode = 'P0001';
  end if;
  update transactions set status = p_status, processed_at = now()
   where id = p_id and status = 'en_attente' and (p_player is null or player_id = p_player)
  returning * into v_tx;
  if v_tx.id is null then
    raise exception 'demande_introuvable' using errcode = 'P0001';
  end if;
  if v_tx.kind = 'depot' and p_status = 'validee' then
    update players set balance = balance + v_tx.amount where id = v_tx.player_id returning balance into v_balance;
    insert into ledger (player_id, amount, reason) values (v_tx.player_id, v_tx.amount, 'depot');
  elsif v_tx.kind = 'retrait' and p_status <> 'validee' then
    update players set balance = balance + v_tx.amount where id = v_tx.player_id returning balance into v_balance;
    insert into ledger (player_id, amount, reason) values (v_tx.player_id, v_tx.amount, 'retrait_rendu');
  else
    select balance into v_balance from players where id = v_tx.player_id;
  end if;
  return v_balance;
end;
$$;

-- Raccourcis pour l'administrateur, à lancer dans l'éditeur SQL : select validate_transaction(12);
create or replace function public.validate_transaction(p_id bigint) returns integer
language sql security invoker set search_path = public
as $$ select close_transaction(p_id, 'validee') $$;
create or replace function public.refuse_transaction(p_id bigint) returns integer
language sql security invoker set search_path = public
as $$ select close_transaction(p_id, 'refusee') $$;

-- Vue d'administration : demandes en attente, les plus anciennes d'abord.
create view public.demandes_en_attente with (security_invoker = true) as
select t.id, t.created_at, p.pseudo, t.kind, t.method, t.amount, t.reference, t.account
  from transactions t join players p on p.id = t.player_id
 where t.status = 'en_attente'
 order by t.created_at;

revoke all on function public.request_transaction(uuid, text, text, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.close_transaction(bigint, text, uuid) from public, anon, authenticated;
revoke all on function public.validate_transaction(bigint) from public, anon, authenticated;
revoke all on function public.refuse_transaction(bigint) from public, anon, authenticated;
revoke all on public.demandes_en_attente from anon, authenticated;
