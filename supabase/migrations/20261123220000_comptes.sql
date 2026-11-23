-- 23/11/2026 : modes de connexion (LeCerf) : compte pseudo + mot de passe, Google (Gmail), Facebook.
-- Le jeton de session du jeu reste le même ; ces colonnes servent seulement à retrouver le compte.

-- Mot de passe haché par le serveur de jeu (PBKDF2-SHA256, sel aléatoire).
alter table public.players add column if not exists password_hash text;
-- Compte Supabase Auth (Google ou Facebook) rattaché au joueur.
alter table public.players add column if not exists auth_user_id uuid unique;
alter table public.players add column if not exists auth_provider text check (auth_provider in ('google','facebook'));
-- Le joueur peut-il se reconnecter (mot de passe ou Google/Facebook) ?
alter table public.players add column if not exists has_login boolean
  generated always as (password_hash is not null or auth_user_id is not null) stored;

-- Un pseudo identifie le compte : unique, sans tenir compte des majuscules.
create unique index if not exists players_pseudo_lower_uniq on public.players (lower(pseudo));
