-- 12/11/2026 : limites d'usage par personne, retrait de pg_net (inutilisée, signalée par l'audit Supabase).

-- Compteurs par clé (adresse hachée) et par tranche de temps. Seule la fonction game y accède.
create table public.rate_limits (
  key text not null,
  bucket timestamptz not null,
  hits integer not null default 0,
  primary key (key, bucket)
);
alter table public.rate_limits enable row level security;

-- Compte un appel et dit s'il reste sous la limite pour la tranche de p_seconds en cours.
create or replace function public.rate_hit(p_key text, p_seconds integer, p_max integer) returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hits integer;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_seconds) * p_seconds);
begin
  insert into rate_limits (key, bucket, hits) values (p_key || ':' || p_seconds, v_bucket, 1)
  on conflict (key, bucket) do update set hits = rate_limits.hits + 1
  returning hits into v_hits;
  -- Ménage occasionnel des anciennes tranches.
  if random() < 0.05 then
    delete from rate_limits where bucket < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;

drop extension if exists pg_net;
