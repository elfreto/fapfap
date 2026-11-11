-- Audit du 11/11/2026 : index sur la clé étrangère ledger.player_id (conseil performance Supabase).
create index if not exists ledger_player_idx on public.ledger (player_id);
