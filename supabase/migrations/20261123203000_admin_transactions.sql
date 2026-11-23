-- 23/11/2026 : page admin des transactions (sans SQL) et référence de dépôt unique.

-- Administrateurs : joueurs autorisés à valider les demandes et à saisir les coordonnées de dépôt.
alter table public.players add column if not exists is_admin boolean not null default false;
-- Administrateur qui a traité la demande.
alter table public.transactions add column if not exists processed_by uuid;

-- Une même référence de dépôt ne peut servir qu'une fois (sans tenir compte des espaces ni des majuscules).
-- Seule exception : une demande annulée par le joueur, qui n'a jamais été créditée.
create unique index if not exists transactions_depot_reference_uniq
  on public.transactions (lower(regexp_replace(reference, '\s', '', 'g')))
  where kind = 'depot' and status <> 'annulee';

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
  if p_kind = 'depot' and exists (
    select 1 from transactions
     where kind = 'depot' and status <> 'annulee'
       and lower(regexp_replace(reference, '\s', '', 'g')) = lower(regexp_replace(p_reference, '\s', '', 'g'))
  ) then
    raise exception 'reference_deja_utilisee' using errcode = 'P0001';
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
  begin
    insert into transactions (player_id, kind, method, amount, reference, account)
    values (p_player, p_kind, p_method, p_amount, p_reference, p_account)
    returning * into v_tx;
  exception when unique_violation then
    -- Deux joueurs envoient la même référence au même instant.
    raise exception 'reference_deja_utilisee' using errcode = 'P0001';
  end;
  return jsonb_build_object('balance', v_balance, 'transaction', to_jsonb(v_tx));
end;
$$;

-- Traitement par un administrateur depuis la page admin : clôture puis trace de qui a traité.
create or replace function public.admin_close_transaction(p_id bigint, p_status text, p_admin uuid) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_status not in ('validee','refusee') then
    raise exception 'statut_invalide' using errcode = 'P0001';
  end if;
  v_balance := close_transaction(p_id, p_status);
  update transactions set processed_by = p_admin where id = p_id;
  return v_balance;
end;
$$;

revoke all on function public.request_transaction(uuid, text, text, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.admin_close_transaction(bigint, text, uuid) from public, anon, authenticated;
