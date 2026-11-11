-- Avatars des joueurs (11/11/2026) : null = initiales, "preset:<id>" = avatar proposé, https://… = photo.
alter table public.players add column avatar text check (avatar is null or char_length(avatar) <= 300);

-- Photos d'avatar : lisibles par tous, écrites uniquement par la fonction game (clé de service).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 300000, array['image/jpeg'])
on conflict (id) do nothing;
